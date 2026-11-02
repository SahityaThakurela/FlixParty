import os
from PIL import Image, ImageDraw

def create_icon(size):
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Margin and radius
    pad = max(1, size // 10)
    radius = max(3, size // 4)
    
    # Background rounded rect (Netflix red look)
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        fill=(229, 9, 20, 255) # Netflix Red #E50914
    )
    
    # Inner dark contrast overlay
    inner_pad = max(2, size // 6)
    draw.rounded_rectangle(
        [inner_pad, inner_pad, size - inner_pad, size - inner_pad],
        radius=max(2, radius - 2),
        fill=(20, 20, 20, 240) # Dark surface
    )
    
    # Play triangle (representing watch) in center
    cx, cy = size / 2, size / 2
    r = size / 4.5
    
    # Play button triangle pointing right
    p1 = (cx - r * 0.7, cy - r)
    p2 = (cx - r * 0.7, cy + r)
    p3 = (cx + r * 1.1, cy)
    draw.polygon([p1, p2, p3], fill=(229, 9, 20, 255))
    
    # Small video/party indicator dot (green active badge in top-right)
    badge_r = max(2, size // 8)
    badge_x = size - pad - badge_r
    badge_y = pad + badge_r
    draw.ellipse(
        [badge_x - badge_r, badge_y - badge_r, badge_x + badge_r, badge_y + badge_r],
        fill=(70, 211, 105, 255), # Neon green
        outline=(20, 20, 20, 255),
        width=max(1, size // 32)
    )
    
    return img

def main():
    os.makedirs('icons', exist_ok=True)
    for size in [16, 48, 128]:
        icon = create_icon(size)
        path = f'icons/icon-{size}.png'
        icon.save(path, 'PNG')
        print(f"Generated {path} ({size}x{size})")

if __name__ == '__main__':
    main()

