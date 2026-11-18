// One stylesheet for HUD + menus. Everything is sized in em from --ui (UI scale setting) so the
// scale slider affects HUD, prompts and menus alike. One font stack, high-contrast colours,
// reduced motion respected (OS preference or the in-game setting via .rm on the root).
export const FONT_STACK =
  'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

export const CSS = `
:root{--ui:1;--ink:#f4f2ec;--ink2:#c9ccd2;--bg:rgba(14,16,20,.78);--panel:#1b1e24;--panel2:#252a32;--line:#3a414c;--accent:#e9c46a;--accent-ink:#1d1a12;--risk:#ffb86b;--danger:#ff8a80;--ok:#7ad7a1;--eye:#ffd88a;--font:${FONT_STACK}}
.ui,.menu,.tc{font:calc(14px*var(--ui))/1.4 var(--font);color:var(--ink)}
.ui{position:fixed;inset:0;pointer-events:none;z-index:20}
.ui *,.menu *,.tc *{box-sizing:border-box}
kbd{display:inline-block;min-width:1.7em;padding:.05em .45em;border:1px solid rgba(255,255,255,.55);border-bottom-width:2px;border-radius:.4em;background:rgba(255,255,255,.12);font:600 .92em var(--font);text-align:center;color:var(--ink)}
.menu kbd{background:#2d333c;border-color:#566070}

/* ---- HUD ---- */
.hud-tl{position:absolute;left:calc(env(safe-area-inset-left,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 12px);width:15.5em;background:var(--bg);padding:.6em .8em;border-radius:.8em;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.hud-row{display:flex;align-items:baseline;justify-content:space-between;gap:.6em}
.hud-clock{font:700 1.7em/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.03em}
.hud-left{font-size:.9em;color:var(--ink2)}
.hud-lesson{margin-top:.35em;font-weight:600}
.hud-phase{color:var(--ink2);font-size:.92em}
.hud-bar{height:.3em;margin-top:.5em;border-radius:.2em;background:rgba(255,255,255,.18);overflow:hidden}.hud-bar>i{display:block;height:100%;background:var(--ink2)}
.hud-teacher{margin-top:.45em;font-size:.92em;color:var(--ink2)}.hud-teacher b{color:var(--ink);font-weight:600}
.hud-tr{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 12px);display:flex;flex-direction:column;align-items:flex-end;gap:.4em;max-width:40vw}
.hud-chip{background:var(--bg);padding:.3em .7em;border-radius:1em;font-size:.92em;white-space:nowrap}
.pips{letter-spacing:.15em}.pips .on{color:var(--risk)}.pips .off{opacity:.45}
.keyhints{color:var(--ink2);font-size:.85em;background:var(--bg);padding:.3em .7em;border-radius:.6em}
.keyhints kbd{font-size:.9em}
.cross{position:absolute;left:50%;top:50%;width:.45em;height:.45em;margin:-.22em 0 0 -.22em;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 2px #000}
.prompt{position:absolute;left:50%;top:calc(50% + 1.8em);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.25em;max-width:min(32em,92vw);text-align:center}
.prompt .main{background:var(--bg);padding:.4em .8em;border-radius:.7em;font-weight:600;font-size:1.1em;display:flex;gap:.55em;align-items:center}
.prompt .tname{font-size:.85em;color:var(--ink2);text-shadow:0 1px 3px #000}
.prompt .warn{font-size:.88em;color:var(--risk);background:var(--bg);padding:.15em .6em;border-radius:.5em}
.prompt .warn.loud{color:var(--danger)}
.prompt .more{font-size:.85em;color:var(--ink2);text-shadow:0 1px 3px #000}
.prompt .ghost{font-size:.85em;color:var(--ink2);opacity:.9;text-shadow:0 1px 3px #000}
.gaze{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 12px);transform:translateX(-50%);display:flex;align-items:center;gap:.5em;background:rgba(40,28,8,.82);border:1px solid var(--eye);color:var(--eye);padding:.35em .9em;border-radius:1.2em;font-weight:600;opacity:0;transition:opacity .25s}
.gaze.on{opacity:1}.gaze.strong{background:rgba(60,14,10,.88);border-color:var(--danger);color:#ffd2cc}
.eye{display:inline-block;width:1.3em;height:.8em;border:.13em solid currentColor;border-radius:50%;position:relative}.eye:after{content:"";position:absolute;left:50%;top:50%;width:.32em;height:.32em;margin:-.16em 0 0 -.16em;border-radius:50%;background:currentColor}
.vignette{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(255,170,60,.34) 100%)}
.vignette.strong{background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(255,70,50,.42) 100%)}
.subs{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 4.2em);transform:translateX(-50%);width:min(760px,92vw);display:flex;flex-direction:column;align-items:center;gap:.3em}
.sub{background:rgba(10,12,15,.78);padding:.3em .7em;border-radius:.5em;transition:opacity .4s}
.sub b{color:#ffd88a}.sub.cue{font-style:italic;color:#bfe3ff}
.toasts{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 3.6em);transform:translateX(-50%);display:flex;flex-direction:column;gap:.4em;align-items:center;max-width:92vw}
.toast{background:rgba(20,24,30,.86);padding:.4em .85em;border-radius:.6em;transition:opacity .5s;text-align:center}
.status{position:absolute;left:calc(env(safe-area-inset-left,0px) + 14px);bottom:calc(env(safe-area-inset-bottom,0px) + 14px);display:flex;flex-direction:column;gap:.4em;align-items:flex-start;max-width:min(26em,60vw)}
.chip{background:var(--bg);padding:.3em .75em;border-radius:1em;font-size:.92em}
.chip.warn{color:var(--risk);border:1px solid rgba(255,184,107,.55)}
.chip .bar{width:9em;height:.4em;background:rgba(255,255,255,.2);border-radius:.2em;overflow:hidden;margin-top:.3em}.chip .bar>i{display:block;height:100%;background:var(--ok)}
.card{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 5.6em);width:min(24em,86vw);background:#fbf7ea;color:#2a2620;border-radius:.4em;padding:.8em 1em;box-shadow:0 8px 30px rgba(0,0,0,.45);transform:rotate(-1.2deg);pointer-events:auto}
.card h3{margin:0 0 .4em;font-size:1.05em;color:#a3261a}.card li{margin:.15em 0}.card ul{padding-left:1.3em;margin:0}
.card .x{float:right;cursor:pointer;opacity:.6;padding:.2em .4em}
.banner{position:absolute;left:50%;top:22%;transform:translateX(-50%);font:700 1.9em var(--font);text-shadow:0 2px 8px #000;transition:opacity .6s;text-align:center;opacity:0;max-width:92vw}
.charge{position:absolute;left:50%;top:calc(50% + 4.8em);transform:translateX(-50%);width:8.5em;height:.45em;background:rgba(255,255,255,.25);border-radius:.25em}.charge>i{display:block;height:100%;background:#ffd23f;border-radius:.25em}
.tip{position:absolute;left:calc(env(safe-area-inset-left,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 11em);width:min(19em,60vw);background:#243044;border:1px solid #5c7499;padding:.6em .8em;border-radius:.7em;pointer-events:auto;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.tip b{display:block;color:#a9c7ff;font-size:.8em;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.2em}
.tip button{margin-top:.5em;pointer-events:auto;background:transparent;color:#a9c7ff;border:0;padding:.4em .2em;font:inherit;text-decoration:underline;cursor:pointer;min-height:2.2em}
.rm .gaze,.rm .vignette,.rm .toast,.rm .sub,.rm .banner{transition:none}
@media (prefers-reduced-motion:reduce){.gaze,.vignette,.toast,.sub,.banner{transition:none}}

/* ---- menus ---- */
.menu{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,11,14,.74);pointer-events:auto;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:30;padding:1em}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:1em;padding:1.4em 1.6em;width:min(46em,100%);max-height:94vh;max-height:94dvh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.panel.wide{width:min(64em,100%)}
.panel h1{margin:0 0 .15em;font-size:2em;line-height:1.15}.panel h2{margin:1.1em 0 .45em;font-size:1.1em}.panel h3{margin:.8em 0 .3em;font-size:1em}
.panel p{margin:.4em 0}.sub2{color:var(--ink2);font-size:.93em}
.panel ul.credits{max-height:40vh;overflow:auto;padding-left:1.3em;font-size:.93em;line-height:1.5}.panel ul.credits a{color:inherit}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:1.4em}
@media (max-width:760px){.cols{grid-template-columns:1fr}.panel{padding:1em 1.1em}}
.how{background:var(--panel2);border-radius:.7em;padding:.7em 1em;margin:.6em 0}.how ul{margin:.3em 0;padding-left:1.2em}.how li{margin:.25em 0}
.field{margin:.7em 0}.field>label{display:block;font-weight:600;margin-bottom:.25em}.field .hint{margin-top:.25em;color:var(--ink2);font-size:.9em;min-height:2.6em}
.field select,.field input[type=text],.field input[type=number]{width:100%}
.row{display:flex;gap:.7em;flex-wrap:wrap;align-items:center;margin:.55em 0}
.row>label{min-width:9em}.row output{min-width:3.2em;color:var(--ink2);font-variant-numeric:tabular-nums}
.row input[type=range]{flex:1;min-width:8em;min-height:2em}
.check{display:flex;gap:.6em;align-items:flex-start;margin:.5em 0}.check input{margin-top:.3em;width:1.15em;height:1.15em}
.btns{display:flex;gap:.6em;flex-wrap:wrap;margin-top:1.1em}.btns.col{flex-direction:column}
.btn{pointer-events:auto;background:var(--accent);color:var(--accent-ink);border:0;border-radius:.7em;padding:.7em 1.2em;font:600 1.05em var(--font);cursor:pointer;min-height:44px}
.btn.alt{background:var(--panel2);color:var(--ink);border:1px solid #4a5360}
.btn.big{font-size:1.2em;padding:.8em 1.6em}.btn.danger{background:#4a2723;color:#ffd2cc;border:1px solid #7b3b35}
.btn.small{padding:.4em .8em;min-height:36px;font-size:.93em}
.btns.col .btn{width:100%;text-align:left}
.btn:focus-visible,.pick:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #8ab4ff;outline-offset:2px}
select,input[type=text],input[type=number]{background:#111419;color:var(--ink);border:1px solid #4a5360;border-radius:.6em;padding:.5em .6em;min-height:44px;font:inherit}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(11em,1fr));gap:.5em}
.pick{background:var(--panel2);border:1px solid var(--line);border-radius:.7em;padding:.55em .65em;cursor:pointer;text-align:left;color:var(--ink);font:inherit;font-size:.93em;min-height:44px}
.pick.on{border-color:var(--accent);background:#3a3423}
details.more{margin-top:.9em}details.more summary{cursor:pointer;color:var(--ink2);padding:.4em 0;min-height:44px;display:flex;align-items:center}
.seg{display:inline-flex;border:1px solid #4a5360;border-radius:.7em;overflow:hidden;margin:.3em 0}.seg button{background:var(--panel2);color:var(--ink);border:0;padding:.5em 1em;font:inherit;cursor:pointer;min-height:44px}.seg button.on{background:var(--accent);color:var(--accent-ink);font-weight:600}
table.rep{width:100%;border-collapse:collapse;font-size:.95em}table.rep td{padding:.35em .4em;border-bottom:1px solid #333a44;vertical-align:top}table.rep td:first-child{white-space:nowrap;padding-right:1em}
.kv{display:grid;grid-template-columns:1fr auto;gap:.2em 1.2em}
.grp{border:1px solid var(--line);border-radius:.8em;padding:.2em 1em .6em;margin:.8em 0}.grp>h2{margin:.7em 0 .3em}
.keylist{display:grid;grid-template-columns:repeat(auto-fill,minmax(14em,1fr));gap:.4em}
.idea-sec{margin:1em 0}.idea-sec>p{margin:.15em 0 .5em}
.ideas{display:grid;grid-template-columns:repeat(auto-fill,minmax(19em,1fr));gap:.5em}
.idea{background:var(--panel2);border:1px solid var(--line);border-radius:.7em;padding:.55em .75em}
.idea.done{opacity:.6}.idea.now{border-color:#4f8a6b}
.idea h4{margin:0 0 .15em;font-size:1em;display:flex;justify-content:space-between;gap:.6em;align-items:baseline}
.idea p{margin:.1em 0;color:var(--ink2);font-size:.92em}.idea .k{font-size:.88em;color:var(--ink)}
.pill{font:600 .75em var(--font);padding:.15em .55em;border-radius:1em;background:#3a414c;white-space:nowrap}.pill.now{background:#24493a;color:#b6f0cd}.pill.done{background:#444;color:#ccc}
.nb{background:#f6f1e1;color:#2b2720;border-radius:.4em;padding:1em;background-image:repeating-linear-gradient(#f6f1e1 0 1.9em,#cfdbe8 1.9em 2em)}
.sticky{display:inline-block;width:10.5em;min-height:7.5em;margin:.5em;padding:.6em;vertical-align:top;box-shadow:0 3px 8px rgba(0,0,0,.25);transform:rotate(var(--r))}
.sticky b{display:block;font-size:1.1em}.face{width:2.3em;height:2.3em;border-radius:50%;border:2px solid #2b2720;float:right;margin-left:.3em}
.mem{font-size:.86em;opacity:.85}
`;
