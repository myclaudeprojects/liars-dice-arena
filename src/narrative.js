// narrative.js — Spectator copy from events that actually happened.
// Presentation never decides the winner.

const FACE = { 1: "ones", 2: "twos", 3: "threes", 4: "fours", 5: "fives", 6: "sixes" };

function faceWord(face) { return FACE[face] || "dice"; }

function classifyPace(view, action) {
  if (!action) return "normal";
  if (action.type === "challenge") return "call";
  const alive = (view.table || []).filter((t) => t.alive !== false);
  const minDice = alive.length ? Math.min(...alive.map((t) => t.diceCount)) : 5;
  const bid = action.type === "bid" ? action : view.currentBid;
  const huge = !!(bid && view.totalDice && bid.count >= Math.ceil(view.totalDice * 0.7));
  const big = !!(bid && view.totalDice && bid.count >= Math.ceil(view.totalDice * 0.55));
  if (minDice <= 1 || huge) return "critical";
  if (minDice <= 2 || big) return "interesting";
  return "normal";
}

function bidAside(action, view, character) {
  if (!action || action.type !== "bid") return null;
  const me = (view.table || []).find((t) => t.id === view.whoseTurn);
  const ahead = !!(me && view.totalDice && me.diceCount >= view.totalDice * 0.55);
  if (ahead && character && character.aggression >= 0.7 && action.count >= Math.ceil((view.totalDice || 1) * 0.45)) {
    return "He's pushing hard.";
  }
  if (view.totalDice && action.count >= Math.ceil(view.totalDice * 0.62)) return "That's a huge claim.";
  return null;
}

function revealHeadline(bidWasTrue) {
  return bidWasTrue ? "HE WAS TELLING THE TRUTH." : "HE WAS BLUFFING.";
}

function diceLine(seats) {
  return (seats || []).map((s) => `${s.name} ${s.dice}`).join(" · ");
}

// Story + highlight from the engine log and the seat list. No invented beats.
function matchStory({ seats, winnerId, log }) {
  const winner = (seats || []).find((s) => s.id === winnerId);
  const loser = (seats || []).find((s) => s.id !== winnerId);
  const challenges = (log || []).filter((e) => e.type === "challenge");
  const last = challenges[challenges.length - 1] || null;
  const hands = (log || []).filter((e) => e.type === "hand_start");
  let down = false;
  if (winner && hands.length) {
    for (const h of hands) {
      const mine = (h.counts || []).find((c) => c.id === winner.id);
      const theirs = (h.counts || []).find((c) => c.id !== winner.id);
      if (mine && theirs && mine.dice < theirs.dice) down = true;
    }
  }
  const calledBluff = !!(last && last.bidWasTrue === false && last.challengerId === winnerId);
  const toldTruth = !!(last && last.bidWasTrue === true && last.bidderId === winnerId);
  let title = winner ? `${winner.name} takes it.` : "No winner.";
  let dek = winner && loser ? `${winner.name} is the last one with dice.` : "";
  if (winner && calledBluff && down) {
    title = `${winner.name} did it.`;
    dek = `Down on dice. Called ${loser ? loser.name + "'s" : "the"} final bluff.`;
  } else if (winner && calledBluff) {
    title = `${winner.name} called the bluff.`;
    dek = last ? `${last.bid.count} ${faceWord(last.bid.face)} were not on the table.` : dek;
  } else if (winner && toldTruth) {
    title = `${winner.name} was telling the truth.`;
    dek = last && loser ? `${loser.name} called, and the dice were there.` : dek;
  } else if (winner && down) {
    title = `${winner.name} came back.`;
    dek = "Had fewer dice, and still finished it.";
  }
  const highlights = [];
  if (calledBluff) highlights.push({ kind: "bluff", text: dek || title });
  if (down && winner) highlights.push({ kind: "comeback", text: `${winner.name} was behind on dice and won.` });
  if (last) {
    highlights.push({
      kind: "call",
      text: `${(seats.find((s) => s.id === last.challengerId) || {}).name || "Someone"} called ${last.bid.count} ${faceWord(last.bid.face)}.`,
      hand: last.hand,
    });
  }
  return {
    title,
    dek,
    result: winner ? `${winner.name} wins.` : "Unfinished.",
    keyMoment: last ? `The call on ${last.bid.count} ${faceWord(last.bid.face)}.` : null,
    turningPoint: down && winner ? `${winner.name} was behind on dice.` : null,
    calledBluff,
    toldTruth,
    comeback: down,
    highlights,
    lesson: last
      ? (last.bidWasTrue
        ? `The bid of ${last.bid.count} ${faceWord(last.bid.face)} was real.`
        : `The bid of ${last.bid.count} ${faceWord(last.bid.face)} was a bluff.`)
      : null,
  };
}

function shareCard({ story, winnerName, streak, loserName, matchId }) {
  const lines = [story?.title || `${winnerName || "Someone"} just did this.`];
  if (story?.dek) lines.push(story.dek);
  if (streak >= 3) lines.push(`WIN STREAK: ${streak}`);
  lines.push("Watch the final call →", "Liar's Dice Arena");
  const id = String(matchId || "");
  return {
    title: lines[0],
    body: lines.slice(1, -2).join("\n"),
    streak: streak || 0,
    text: lines.join("\n"),
    loserName: loserName || null,
    matchId: id || null,
    href: id ? `#replay=${encodeURIComponent(id)}` : "",
  };
}

module.exports = {
  faceWord, classifyPace, bidAside, revealHeadline, diceLine, matchStory, shareCard,
};
