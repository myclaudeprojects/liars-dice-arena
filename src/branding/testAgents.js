const { buildVisualDNA } = require("./buildVisualDNA");

const neonAgents = [
  {
    id: "executive_viktor",
    name: "Victor Vale",
    title: "The Executive",
    archetype: "executive",
    brand: {
      visualDNA: buildVisualDNA({ archetype: "executive" }),
    },
  },
  {
    id: "street_ace",
    name: "Ace Monroe",
    title: "The Street Player",
    archetype: "street",
    brand: {
      visualDNA: buildVisualDNA({ archetype: "street" }),
    },
  },
  {
    id: "robot_zeno",
    name: "Zeno-9",
    title: "The Machine",
    archetype: "robot_ai",
    brand: {
      visualDNA: buildVisualDNA({ archetype: "robot_ai" }),
    },
  },
];

module.exports = { neonAgents };
