// One-off patch: mobile redesign for the live table + scrollable nav on all pages. Idempotent.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const rw = (f, fn) => { const p = path.join(root, f); const a = fs.readFileSync(p, "utf8"); const b = fn(a); fs.writeFileSync(p, b); console.log(f, a === b ? "(no change)" : "patched"); };
const rep = (s, from, to) => { if (s.includes(to)) return s; if (!s.includes(from)) throw new Error("anchor missing: " + from.slice(0, 70)); return s.replace(from, to); };

rw("public/site.css", (s) => {
  if (s.includes("/* mobile nav */")) return s;
  return s + `
/* mobile nav */
@media (max-width:640px){
  .wrap{padding:0 14px}
  nav.top{padding:12px 0;gap:8px;flex-wrap:nowrap;align-items:center}
  nav.top .brand{font-size:16px;white-space:nowrap;flex:0 0 auto}
  nav.top ul{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;gap:4px;flex:1 1 auto;justify-content:flex-end}
  nav.top ul::-webkit-scrollbar{display:none}
  nav.top li a{white-space:nowrap;padding:8px 10px;font-size:13px}
  footer{flex-direction:column;gap:6px;padding:20px 0 30px}
  h1{font-size:30px}
  .lede{font-size:16px}
}
`;
});

rw("public/index.html", (s) => {
  if (s.includes("/* ---------- mobile ---------- */")) return s;
  // stake input: numeric keypad on phones
  s = rep(s, `<input id="stake" type="number" min="0.05" max="1000" step="0.05" value="1" aria-label="Stake in USDC" />`,
             `<input id="stake" type="number" inputmode="decimal" min="0.05" max="1000" step="0.05" value="1" aria-label="Stake in USDC" />`);
  // short explainer link for phones (the long paragraph is hidden there)
  s = rep(s, `    <div class="msg" id="msg"></div>
    <div class="howto">`, `    <div class="msg" id="msg"></div>
    <a class="howlink" href="/how-it-works#betting">How betting works →</a>
    <div class="howto">`);
  // mobile stylesheet appended to the page's own <style>, so it wins the cascade
  s = rep(s, `  .howto{font-size:13px;color:#5c5a52;margin-top:10px;line-height:1.5}
</style>`, `  .howto{font-size:13px;color:#5c5a52;margin-top:10px;line-height:1.5}
  .howlink{display:none}

  /* ---------- mobile ---------- */
  @keyframes shakeM{0%,100%{transform:none}20%{transform:translateX(-6px) rotate(-1deg)}40%{transform:translateX(6px) rotate(1deg)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
  @media (max-width:900px){
    /* table: seats in a row, game state right under them, one screen tall */
    .table{display:block;height:auto;min-height:0;padding:0 0 10px;border-width:10px;border-radius:28px}
    .banner{position:static;transform:none;margin:12px auto 4px;width:max-content;max-width:calc(100% - 24px);white-space:normal;text-align:center;font-size:12px;padding:7px 14px}
    .banner b{font-size:14px}
    #seats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 10px 0}
    .seat{position:static;transform:none;width:auto;margin:0;padding:8px 4px 6px;border-radius:12px}
    .seat.shake{animation:shakeM .55s ease-in-out}
    .seat .name{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .seat .kind{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .seat .thought{display:none}
    .dice{gap:4px;margin:8px 0 0;min-height:22px;flex-wrap:wrap}
    .die{width:20px;height:20px;border-radius:5px}
    .die .pip{width:4px;height:4px}
    .center{position:static;transform:none;width:auto;margin:10px 12px 0}
    .now{min-height:52px;margin-bottom:8px}
    .nowtext{font-size:17px}
    .nowtext .q{font-size:13px}
    .nowbar{width:140px}
    .bidchip{min-width:0;padding:9px 18px 9px 14px;font-size:19px;gap:10px}
    .bidchip .who{font-size:12px}
    .tally{font-size:13px;min-height:18px}
    .tally b{font-size:24px}
    .pot{margin-top:8px;font-size:13px}
    .pot b{font-size:24px}
    .status{position:static;padding:8px 12px 0;font-size:13px}
    .burst{font-size:54px}
    .burst.gold{font-size:30px;white-space:normal;max-width:90%;text-align:center}
    .float{font-size:18px}
    aside{gap:12px}
    .log{max-height:190px;font-size:12.5px}
    header{margin:0 0 12px}
    h1.t{font-size:22px}
    h1.t small{font-size:13px;margin-top:4px}
    .chain{font-size:12px}
  }
  @media (max-width:640px){
    /* betting as a bottom sheet */
    .wrap{padding-bottom:300px}
    .rail{position:fixed;left:0;right:0;bottom:0;z-index:20;margin:0;border-radius:16px 16px 0 0;border-width:1px 0 0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));box-shadow:0 -8px 30px rgba(30,20,10,.25);max-height:62vh;overflow:auto}
    .railhead h2{font-size:15px}
    .railhead .clock{font-size:18px;min-width:40px}
    #closednote{margin:4px 0 8px;font-size:12px}
    .picks{grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0}
    .pick{padding:8px 6px;border-radius:10px;min-height:56px}
    .pick .n{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pick .m{font-size:11px;margin-top:3px;line-height:1.25}
    .pick .m b{font-size:13px}
    .place{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:stretch}
    #connect{grid-column:1 / -1;width:100%;text-align:center}
    .place input{width:100%;min-height:44px;font-size:16px}
    .place > span:not(.me){display:none}
    .place button#betbtn{min-height:44px;padding:0 18px;white-space:nowrap}
    .me{grid-column:1 / -1;font-size:12px;line-height:1.35}
    .msg{font-size:12.5px;margin-top:6px}
    .howto{display:none}
    .howlink{display:inline-block;font-size:12px;color:#5c5a52;margin-top:6px}
    footer{padding-bottom:10px}
  }
</style>`);
  // mobile: the "USDC on <agent>" label is hidden, so show the picked agent on the button itself
  s = rep(s, `document.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{picked=b.dataset.id;$('#picked').textContent=seats.find(s=>s.id===picked).name;renderPicks();`,
             `document.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{picked=b.dataset.id;const nm=seats.find(s=>s.id===picked).name;$('#picked').textContent=nm;if(matchMedia('(max-width:640px)').matches)$('#betbtn').textContent='Bet on '+nm;renderPicks();`);
  return s;
});

rw("public/landing.html", (s) => {
  if (s.includes("/* mobile */")) return s;
  return rep(s, `  .quote .who{color:var(--mute);font-size:13px;margin-top:8px}`, `  .quote .who{color:var(--mute);font-size:13px;margin-top:8px}
  /* mobile */
  @media (max-width:640px){
    .hero{padding:18px 0 16px;gap:22px}
    .hero h1{font-size:36px}
    .hero .actions .btn{width:100%;text-align:center}
    .live{border-width:8px;border-radius:120px/80px;padding:26px 18px;min-height:220px}
    .live .big{font-size:24px}
    .strip .panel b{font-size:24px}
    section.block{padding:36px 0 0}
    section.block h2{font-size:26px}
    .quote{padding:22px 20px}
    .quote .t{font-size:19px}
    .token{padding:20px 18px}
    .token .btns .btn{width:100%;text-align:center}
  }`);
});
console.log("done");
