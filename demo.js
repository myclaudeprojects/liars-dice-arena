// demo.js — Watch a full match right now. No API keys, no chain.
//   node demo.js
// Agents play Arena Credits. Swap MockAgent -> LLMAgent when ready.

const { MockAgent } = require("./src/agents");
const { CreditBook } = require("./src/credits");
const { runMatch } = require("./src/arena");

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  mag: (s) => `\x1b[35m${s}\x1b[0m`,
};

function print(ev) {
  switch (ev.type) {
    case "ante":
      console.log(C.dim(`  💰 ${ev.name} antes ${ev.amount} credits`));
      break;
    case "pot_ready":
      console.log(C.bold(`  🏆 Table pot: ${ev.total} credits (Arena Credits only)\n`));
      break;
    case "match_start":
      console.log(C.bold("  Seats: ") + ev.seats.map((s) => `${s.name}[${s.kind}]`).join("  vs  ") + "\n");
      break;
    case "turn": {
      const a = ev.action;
      const move = a.type === "challenge"
        ? C.red("CHALLENGE! ‘Liar!’")
        : C.cyan(`bid ${a.count} × ${a.face}`);
      console.log(`  ${C.bold(ev.name)}: ${move}`);
      if (ev.thought) console.log(C.dim(`      “${ev.thought}”`));
      break;
    }
    case "reveal": {
      const hands = ev.reveal.map((r) => `${r.name}[${r.dice.join(",")}]`).join("  ");
      console.log(C.yellow(`   ↳ reveal: ${hands}`));
      console.log(C.yellow(`     bid was ${ev.bid.count}×${ev.bid.face}; actual ${ev.actual} → ${ev.bidWasTrue ? "TRUE" : "LIE"}. ${C.bold(ev.loserName)} drops a die.\n`));
      break;
    }
    case "illegal":
      console.log(C.red(`   (illegal ${JSON.stringify(ev.action)}: ${ev.error} — forced challenge)`));
      break;
    case "settled":
      console.log(C.green(C.bold(`\n  🎉 ${ev.name} wins ${ev.amount} credits`)));
      break;
  }
}

(async () => {
  const credits = new CreditBook({ persist: false, starting: 20 });
  const agents = [
    new MockAgent({ id: "claude", name: "Claude", aggression: 0.45 }),
    new MockAgent({ id: "gpt", name: "GPT", aggression: 0.7 }),
    new MockAgent({ id: "llama", name: "Llama", aggression: 0.3 }),
  ];

  console.log(C.bold("\n════ LIAR'S DICE ARENA — Arena Credits ════\n"));
  const result = await runMatch({
    agents, credits, ante: 1, seed: 7,
    onEvent: print,
  });

  console.log(C.bold("\n  Final seats:"));
  for (const ag of agents) {
    console.log(`   ${ag.name}: ${result.balances[ag.id]} credits`);
  }
  console.log();
})();
