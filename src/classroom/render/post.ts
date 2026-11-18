// Post-processing pipeline, per quality preset:
//   post 'high' : RenderPass -> GTAO (contact shadows) -> light bloom -> OutputPass -> SMAA
//   post 'low'  : RenderPass -> OutputPass -> SMAA
//   post 'off'  : plain renderer.render (tone mapping in the material shaders; Battery Saver / Low)
// The composer is built lazily, follows the canvas size, and any error drops to the plain render.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { QualitySettings } from '../quality';

export class PostPipeline {
  private composer: EffectComposer | null = null;
  private key = '';
  private sizeKey = '';
  private renderPass: RenderPass | null = null;
  private gtao: GTAOPass | null = null;
  private failed = false;
  private hideCache: THREE.Object3D[] = [];
  private noAo: THREE.Object3D[] = [];
  private noAoScene: THREE.Scene | null = null;
  private frame = 0;
  private readonly v2 = new THREE.Vector2();
  /** Which path the last render() took (for __info / tests). */
  active: 'off' | 'low' | 'high' = 'off';

  constructor(private renderer: THREE.WebGLRenderer) {}

  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    q: Pick<QualitySettings, 'post' | 'ao'>,
    exposure: number,
  ): void {
    const r = this.renderer;
    r.toneMappingExposure = exposure;
    const mode = this.failed ? 'off' : q.post;
    this.active = mode;
    if (mode === 'off') {
      r.render(scene, camera);
      return;
    }
    try {
      const composer = this.ensure(mode, q.ao, scene, camera);
      this.syncSize(composer);
      if (this.renderPass) {
        this.renderPass.scene = scene;
        this.renderPass.camera = camera;
      }
      if (this.gtao) {
        this.gtao.scene = scene;
        this.gtao.camera = camera;
        this.refreshNoAo(scene);
      }
      composer.render(0);
    } catch (e) {
      console.warn('Post-processing failed, using the plain renderer:', e);
      this.failed = true;
      this.active = 'off';
      this.disposeComposer();
      r.setRenderTarget(null);
      r.render(scene, camera);
    }
  }

  private ensure(
    mode: 'low' | 'high',
    ao: boolean,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): EffectComposer {
    const key = `${mode}:${ao ? 1 : 0}`;
    if (this.composer && key === this.key) return this.composer;
    this.disposeComposer();
    const r = this.renderer;
    const size = r.getDrawingBufferSize(this.v2);
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
    const composer = new EffectComposer(r, rt);
    composer.setPixelRatio(1);
    composer.setSize(w, h);
    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);
    if (mode === 'high') {
      if (ao) {
        const gtao = new GTAOPass(scene, camera, w, h);
        gtao.updateGtaoMaterial({
          radius: 0.4,
          distanceExponent: 1.5,
          thickness: 1.2,
          scale: 1.0,
          samples: 12,
          distanceFallOff: 1,
          screenSpaceRadius: false,
        });
        gtao.updatePdMaterial({
          lumaPhi: 10,
          depthPhi: 2,
          normalPhi: 3,
          radius: 4,
          radiusExponent: 1,
          rings: 2,
          samples: 12,
        });
        gtao.blendIntensity = 0.85;
        this.gtao = gtao;
        // GTAO draws normals with an override material: keep sprites/shafts/dust out of it.
        const orig = gtao.render.bind(gtao);
        gtao.render = (...a: Parameters<GTAOPass['render']>) => {
          this.hideCache.length = 0;
          for (const o of this.noAo) {
            if (o.visible) {
              o.visible = false;
              this.hideCache.push(o);
            }
          }
          try {
            orig(...a);
          } finally {
            for (const o of this.hideCache) o.visible = true;
            this.hideCache.length = 0;
          }
        };
        composer.addPass(gtao);
      }
      // Light bloom: only HDR-bright things (windows, projector screen, sun patches) pass 1.5.
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.16, 0.6, 1.5));
    }
    composer.addPass(new OutputPass());
    composer.addPass(new SMAAPass());
    this.composer = composer;
    this.key = key;
    this.sizeKey = `${w}x${h}`;
    return composer;
  }

  private syncSize(composer: EffectComposer): void {
    const size = this.renderer.getDrawingBufferSize(this.v2);
    const k = `${size.x}x${size.y}`;
    if (k === this.sizeKey) return;
    this.sizeKey = k;
    composer.setPixelRatio(1);
    composer.setSize(size.x, size.y);
  }

  private refreshNoAo(scene: THREE.Scene): void {
    if (this.noAoScene === scene && this.frame++ % 45 !== 0) return;
    this.noAoScene = scene;
    this.frame = 1;
    const out: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const s = o as THREE.Sprite;
      if (s.isSprite || o.userData?.noAO) out.push(o);
    });
    this.noAo = out;
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.gtao?.dispose();
    this.composer = null;
    this.gtao = null;
    this.renderPass = null;
    this.key = '';
  }

  dispose(): void {
    this.disposeComposer();
  }
}
