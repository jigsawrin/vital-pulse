import os
from PIL import Image

def gif_to_sprite_sheet(gif_path, output_path):
    if not os.path.exists(gif_path):
        print(f"Error: {gif_path} not found.")
        return
    
    img = Image.open(gif_path)
    frames = []
    
    try:
        while True:
            # Extract each frame and convert to RGBA for transparency
            frames.append(img.copy().convert("RGBA"))
            img.seek(len(frames))
    except EOFError:
        pass
    
    if not frames:
        return

    # Create sprite sheet (horizontal layout)
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h))
    
    for i, frame in enumerate(frames):
        sheet.paste(frame, (i * w, 0))
    
    sheet.save(output_path, "PNG")
    print(f"Saved: {output_path} ({len(frames)} frames)")

# Target assets
base_dir = "c:/Users/nuies/.gemini/antigravity/scratch/vital-pulse/assets/characters"
conversions = [
    ("tank_walk.gif", "tank_walk.png"),
    ("tank_attack.gif", "tank_attack.png"),
    ("tank_ult.gif", "tank_ult.png"),
    ("hitscan_walk.gif", "attacker_walk.png"),
    ("hitscan_attack.gif", "attacker_attack.png"),
    ("hitscan_ult.gif", "attacker_ult.png")
]

for src, dest in conversions:
    gif_to_sprite_sheet(os.path.join(base_dir, src), os.path.join(base_dir, dest))
