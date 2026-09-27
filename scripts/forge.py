# forge.py — local, CPU-only neon portrait generator for Liar's Dice Arena.
# No API key. First run downloads the SD-Turbo weights (~2.5 GB) from Hugging Face.
#
#   .venv\Scripts\python.exe forge.py --test            # 6 quick samples -> out\test\
#   .venv\Scripts\python.exe forge.py --bank 300        # the library -> out\bank\ + manifest.json
#   .venv\Scripts\python.exe forge.py --house           # 4 candidates per house-cast member -> out\house\
#
# Output: 512x512 PNG + a manifest with the tags each image was generated from.
import argparse, json, os, random, time, hashlib
from pathlib import Path

import torch
from diffusers import AutoPipelineForText2Image

MODEL = "stabilityai/sd-turbo"
OUT = Path(__file__).parent / "out"
torch.set_num_threads(max(1, os.cpu_count() or 4))

# ---------------------------------------------------------------- vocabulary (mirrors the site's option groups)
ARCHETYPE = {
    "executive": "confident executive in a tailored suit, wealth and power",
    "street": "urban street hustler, gritty modern streetwear",
    "athlete": "elite athlete, sporty and competitive",
    "celebrity": "glamorous celebrity, famous and polished",
    "tech": "cyber-tech operator with subtle augmentation",
    "criminal": "dangerous underworld figure, rough and intimidating",
    "antihero": "dark mysterious antihero",
    "comedian": "quirky funny entertainer",
    "animal": "anthropomorphic animal character, mascot style",
    "primal": "wild primal warrior",
    "robot_ai": "sleek humanoid robot, mechanical synthetic",
    "experimental": "surreal experimental character, unique and creative",
    "gambler": "high-stakes gambler, sly and composed",
    "dealer": "casino dealer, sharp and precise",
    "hacker": "underground hacker, hooded and intense",
    "royalty": "regal royalty, crown and gold",
}
BODY = {
    "male_lean": "lean man", "male_muscular": "muscular man", "female_lean": "slim woman",
    "female_athletic": "athletic woman", "androgynous": "androgynous person", "heavy_set": "heavy-set person",
    "elder": "elderly person with grey hair", "young_adult": "young adult", "non_human": "non-human creature",
    "full_robot": "full chrome android", "skeletal_synthetic": "skeletal synthetic being",
}
EXPRESSION = {
    "calm": "calm serene expression", "confident": "confident smirk", "aggressive": "aggressive snarl",
    "playful": "playful grin, tongue out", "mysterious": "mysterious shadowed gaze", "intense": "intense stare",
    "intellectual": "thoughtful intellectual look, hand on chin", "laid_back": "laid-back relaxed smile",
    "cocky": "cocky raised eyebrow", "serious": "stern serious face", "unhinged": "unhinged wide-eyed manic grin",
}
ATTIRE = {
    "formal": "black tuxedo with tie", "casual": "casual jacket and t-shirt", "streetwear": "streetwear hoodie and cap",
    "sports": "athletic jersey", "tactical": "tactical gear with straps", "luxury": "fur coat and gold chains",
    "business": "business suit and vest", "hood_mask": "hood and face mask", "performance_costume": "flamboyant stage costume",
    "cyber_gear": "cyberpunk armor with glowing panels", "minimal": "plain dark top",
    "trench_coat": "long trench coat", "bomber_jacket": "bomber jacket", "robe": "ornate robe with gold trim", "plate_armor": "futuristic plate armor",
}
PALETTE = {
    "red": "red and crimson neon", "blue": "electric blue neon", "purple": "violet and magenta neon", "pink": "hot pink neon",
    "green": "acid green neon", "orange": "orange and amber neon", "gold": "golden neon", "cyan": "cyan neon",
    "yellow": "yellow neon", "monochrome": "monochrome silver light", "multi": "rainbow multicolor neon",
}
BACKGROUND = {
    "city_night": "neon city at night", "underground": "underground tunnel", "club": "nightclub lights",
    "casino": "casino floor with chips and cards", "studio": "dark studio backdrop", "tech_lab": "high-tech laboratory",
    "vault": "steel bank vault", "arena": "stadium arena crowd", "space": "outer space with stars", "abstract": "abstract neon shapes",
    "dice_table": "green felt dice table", "rooftop": "city rooftop at night", "boardroom": "corporate boardroom",
    "neon_alley": "rainy neon alley", "bunker": "concrete bunker",
}
ACCESSORY = {
    "glasses": "wearing sunglasses", "hat_cap": "wearing a cap", "mask": "wearing a face mask", "headphones": "wearing headphones",
    "smoke": "smoking a cigar, smoke", "jewelry": "gold jewelry and chains", "scar_tattoo": "face scar and neck tattoos",
    "pet": "small pet bulldog on shoulder", "prop": "holding a weapon prop", "unique_fx": "glowing energy effects", "none": "",
    "dice": "holding dice", "chips": "stack of poker chips", "cards": "fanning playing cards", "cigar": "lit cigar",
}
SKIN = ["porcelain skin", "fair skin", "olive skin", "tan skin", "brown skin", "deep brown skin", "dark ebony skin"]
HAIR = ["short buzz cut", "slicked back hair", "undercut", "long hair", "wild spiky hair", "braids", "mohawk", "hair in a bun", "bald head", "silver hair", "neon dyed hair"]

STYLE = "cinematic neon portrait, head and shoulders, looking at camera, dark background, rim light, photorealistic, detailed face"
NEGATIVE = "cartoon, anime, illustration, sketch, blurry, deformed, extra fingers, watermark, text, logo, duplicate, cropped head"

def prompt_for(t):
    parts = [
        f"{BODY[t['bodyType']]}, {ARCHETYPE[t['archetype']]}",
        t.get("skin", ""), t.get("hair", ""),
        EXPRESSION[t["expression"]], f"wearing {ATTIRE[t['attire']]}", ACCESSORY.get(t.get("accessories", "none"), ""),
        f"{PALETTE[t['colorPalette']]}", BACKGROUND[t["background"]], STYLE,
    ]
    text = ", ".join(p for p in parts if p)
    words = text.split()
    return " ".join(words[:58])  # keep inside the 77-token CLIP window; style words are last so they still fit

def seed_for(tags):
    return int(hashlib.sha1(json.dumps(tags, sort_keys=True).encode()).hexdigest()[:8], 16)

HUMAN_BODIES = ["male_lean", "male_muscular", "female_lean", "female_athletic", "androgynous", "heavy_set", "elder", "young_adult"]
def sample_tags(rng, i):
    # archetype first; body type follows it (robots/animals only when the archetype calls for them)
    archetype = rng.choice(list(ARCHETYPE))
    if archetype == "robot_ai": body = rng.choice(["full_robot", "skeletal_synthetic"])
    elif archetype in ("animal", "primal"): body = "non_human"
    else: body = rng.choice(HUMAN_BODIES)
    return {
        "archetype": archetype, "bodyType": body, "expression": rng.choice(list(EXPRESSION)),
        "attire": rng.choice(list(ATTIRE)), "colorPalette": rng.choice(list(PALETTE)), "background": rng.choice(list(BACKGROUND)),
        "accessories": rng.choice(list(ACCESSORY)), "skin": rng.choice(SKIN), "hair": rng.choice(HAIR), "n": i,
    }

def fix_tags(t):
    # keep combinations coherent: robots have no skin/hair, animals no skin
    if t["bodyType"] in ("full_robot", "skeletal_synthetic") or t["archetype"] == "robot_ai":
        t["archetype"] = "robot_ai"; t["bodyType"] = "full_robot" if t["bodyType"] != "skeletal_synthetic" else t["bodyType"]; t["skin"] = ""; t["hair"] = ""
    if t["archetype"] in ("animal", "primal") or t["bodyType"] == "non_human":
        t["bodyType"] = "non_human"; t["skin"] = ""
    return t

HOUSE = {
    "dracula": dict(archetype="gambler", bodyType="male_lean", expression="cocky", attire="formal", colorPalette="red", background="casino", accessories="none", skin="porcelain skin", hair="slicked back hair", extra="vampire fangs, gold crown"),
    "caesar": dict(archetype="royalty", bodyType="male_muscular", expression="serious", attire="robe", colorPalette="gold", background="boardroom", accessories="none", skin="olive skin", hair="short curly hair", extra="laurel wreath"),
    "reaper": dict(archetype="antihero", bodyType="skeletal_synthetic", expression="mysterious", attire="hood_mask", colorPalette="purple", background="underground", accessories="none", skin="", hair="", extra="hooded reaper"),
    "athena": dict(archetype="tech", bodyType="female_lean", expression="intellectual", attire="plate_armor", colorPalette="gold", background="vault", accessories="glasses", skin="olive skin", hair="long hair", extra="owl emblem"),
    "shark": dict(archetype="criminal", bodyType="male_muscular", expression="aggressive", attire="tactical", colorPalette="green", background="city_night", accessories="scar_tattoo", skin="tan skin", hair="buzz cut", extra=""),
    "oracle": dict(archetype="experimental", bodyType="androgynous", expression="calm", attire="robe", colorPalette="purple", background="space", accessories="unique_fx", skin="fair skin", hair="silver hair", extra="glowing eyes"),
    "fox": dict(archetype="animal", bodyType="non_human", expression="playful", attire="streetwear", colorPalette="orange", background="neon_alley", accessories="cards", skin="", hair="", extra="fox"),
    "brutus": dict(archetype="criminal", bodyType="heavy_set", expression="intense", attire="bomber_jacket", colorPalette="orange", background="bunker", accessories="cigar", skin="brown skin", hair="bald head", extra="dagger"),
    "monk": dict(archetype="experimental", bodyType="elder", expression="calm", attire="robe", colorPalette="green", background="studio", accessories="none", skin="tan skin", hair="bald head", extra="stone beads"),
    "siren": dict(archetype="celebrity", bodyType="female_athletic", expression="mysterious", attire="performance_costume", colorPalette="cyan", background="club", accessories="jewelry", skin="deep brown skin", hair="long hair", extra="crescent moon motif"),
    "miser": dict(archetype="dealer", bodyType="elder", expression="serious", attire="business", colorPalette="gold", background="vault", accessories="chips", skin="fair skin", hair="grey slicked hair", extra="locked coin"),
    "jester": dict(archetype="comedian", bodyType="young_adult", expression="unhinged", attire="performance_costume", colorPalette="pink", background="arena", accessories="mask", skin="porcelain skin", hair="neon dyed hair", extra="broken mask"),
}

def load():
    pipe = AutoPipelineForText2Image.from_pretrained(MODEL, torch_dtype=torch.float32)
    pipe.to("cpu")
    pipe.set_progress_bar_config(disable=True)
    return pipe

def generate(pipe, prompt, seed, steps=4, size=512):
    g = torch.Generator("cpu").manual_seed(seed)
    return pipe(prompt=prompt, negative_prompt=NEGATIVE, num_inference_steps=steps, guidance_scale=0.0, width=size, height=size, generator=g).images[0]

def run(items, folder, pipe, manifest_name="manifest.json"):
    folder.mkdir(parents=True, exist_ok=True)
    manifest = []
    for i, (name, tags, extra) in enumerate(items):
        path = folder / f"{name}.png"
        if path.exists():
            manifest.append({"file": path.name, "tags": tags}); continue
        prompt = prompt_for(tags) + (f", {extra}" if extra else "")
        t0 = time.time()
        img = generate(pipe, prompt, seed_for({**tags, "name": name}))
        img.save(path)
        img.convert("RGB").save(path.with_suffix(".webp"), "WEBP", quality=82, method=6)
        manifest.append({"file": path.name, "tags": tags, "prompt": prompt})
        (folder / manifest_name).write_text(json.dumps(manifest, indent=1))
        print(f"[{i+1}/{len(items)}] {path.name}  {time.time()-t0:.0f}s", flush=True)
    return manifest

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--test", action="store_true"); ap.add_argument("--bank", type=int, default=0); ap.add_argument("--house", action="store_true"); ap.add_argument("--seed", type=int, default=7)
    a, _unknown = ap.parse_known_args()
    pipe = load() if (a.test or a.house or a.bank) else None
    rng = random.Random(a.seed)
    if a.test:
        picks = [("t_exec", dict(archetype="executive", bodyType="male_lean", expression="confident", attire="formal", colorPalette="red", background="city_night", accessories="smoke", skin="tan skin", hair="slicked back hair"), ""),
                 ("t_street", dict(archetype="street", bodyType="male_muscular", expression="cocky", attire="streetwear", colorPalette="purple", background="neon_alley", accessories="hat_cap", skin="brown skin", hair="short buzz cut"), ""),
                 ("t_celeb", dict(archetype="celebrity", bodyType="female_lean", expression="playful", attire="luxury", colorPalette="pink", background="club", accessories="jewelry", skin="fair skin", hair="long hair"), ""),
                 ("t_robot", dict(archetype="robot_ai", bodyType="full_robot", expression="intense", attire="cyber_gear", colorPalette="cyan", background="tech_lab", accessories="unique_fx", skin="", hair=""), ""),
                 ("t_elder", dict(archetype="dealer", bodyType="elder", expression="serious", attire="business", colorPalette="gold", background="casino", accessories="chips", skin="olive skin", hair="silver hair"), ""),
                 ("t_animal", dict(archetype="animal", bodyType="non_human", expression="playful", attire="casual", colorPalette="orange", background="dice_table", accessories="glasses", skin="", hair=""), "bulldog")]
        run(picks, OUT / "test", pipe)
    if a.house:
        items = []
        for aid, spec in HOUSE.items():
            for k in range(4):
                tags = {kk: v for kk, v in spec.items() if kk != "extra"}; tags["variant"] = k
                items.append((f"{aid}_{k+1}", tags, spec["extra"]))
        run(items, OUT / "house", pipe)
    if a.bank:
        items = [(f"bank_{i:04d}", fix_tags(sample_tags(rng, i)), "") for i in range(a.bank)]
        run(items, OUT / "bank", pipe)

# ---------------------------------------------------------------- continuous bank
# Appended by patch: `python forge.py --loop` keeps generating new bank portraits forever.
# Each new index gets its own deterministic tag roll (no repeats), resumes after restarts,
# and is written straight into out/bank/manifest.json for the sync job to ingest.
import re as _re

def _bank_indices():
    d = OUT / "bank"; d.mkdir(parents=True, exist_ok=True)
    idx = [int(m.group(1)) for f in list(d.glob("bank_*.png")) + list(d.glob("bank_*.webp")) for m in [_re.match(r"bank_(\d+)\.(?:png|webp)$", f.name)] if m]
    return sorted(idx)

def _load_manifest(folder):
    mf = folder / "manifest.json"
    try: return json.loads(mf.read_text())
    except Exception: return []

def _dhash(img, s=8):
    im = img.convert("L").resize((s + 1, s)); px = list(im.getdata()); bits = 0
    for y in range(s):
        for x in range(s): bits = (bits << 1) | (1 if px[y * (s + 1) + x] > px[y * (s + 1) + x + 1] else 0)
    return bits

def loop_bank(pipe, batch_pause=0):
    folder = OUT / "bank"
    manifest = [r for r in _load_manifest(folder) if (folder / r["file"].replace(".png", ".webp")).exists()]
    from PIL import Image as _Image
    hashes = []
    for r in manifest:
        try: hashes.append(_dhash(_Image.open(folder / r["file"].replace(".png", ".webp"))))
        except Exception: pass
    print(f"loop: {len(hashes)} perceptual hashes loaded for the look-alike guard", flush=True)
    seen_prompts = {row.get("prompt") for row in manifest}
    idx = _bank_indices()
    n = (idx[-1] + 1) if idx else 0
    print(f"loop: resuming at bank_{n:04d}, {len(manifest)} in manifest", flush=True)
    cap = int(os.environ.get("LOOP_CAP", "2500"))
    while True:
        if len(manifest) >= cap:                # stockpile deep enough: idle, re-check later
            print(f"[loop] {len(manifest)} on disk >= cap {cap}; sleeping 10 min", flush=True); time.sleep(600); continue
        tags = fix_tags(sample_tags(random.Random(1_000_003 * n + 17), n))
        name = f"bank_{n:04d}"
        prompt = prompt_for(tags)
        if prompt in seen_prompts:            # identical roll already exists: move on
            n += 1; continue
        path = folder / f"{name}.png"
        t0 = time.time()
        img = generate(pipe, prompt, seed_for({**tags, "name": name}))
        h = _dhash(img)
        if any(bin(h ^ old).count("1") <= 10 for old in hashes):   # look-alike of something in the bank: reroll
            print(f"[loop] {name} looked like an existing portrait; discarded", flush=True); n += 1; continue
        hashes.append(h)
        img.convert("RGB").save(path.with_suffix(".webp"), "WEBP", quality=82, method=6)   # webp only: the site uses this
        manifest.append({"file": path.with_suffix(".webp").name, "tags": tags, "prompt": prompt})
        seen_prompts.add(prompt)
        (folder / "manifest.json").write_text(json.dumps(manifest, indent=1))
        print(f"[loop] {name}  {time.time()-t0:.0f}s  (bank now {len(manifest)})", flush=True)
        n += 1
        if batch_pause: time.sleep(batch_pause)

if __name__ == "__main__" and "--loop" in os.sys.argv:
    loop_bank(load())
