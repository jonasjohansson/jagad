# Toon Shader Features

## Overview
Added toon shader support to the /game/ page with a GUI control panel using lil-gui.

## Features Added

### 1. GUI Controls
- **Location**: Top-left corner of the game view
- **Library**: lil-gui (loaded via CDN in game/index.html)
- **Styling**: Custom dark theme matching the game aesthetic

### 2. Toon Shader Settings

#### Enable Toon Shader
- **Type**: Checkbox
- **Default**: Off (uses standard MeshStandardMaterial)
- **Effect**: Toggles between standard PBR rendering and cel-shaded toon rendering

#### Gradient Steps
- **Type**: Slider (2-10 steps)
- **Default**: 3 steps
- **Effect**: Controls the number of shading bands in the toon effect
  - 2 steps = High contrast, comic book style
  - 10 steps = Smoother gradients, subtle toon effect

#### Enable Outline
- **Type**: Checkbox
- **Default**: Off
- **Status**: Placeholder (logs to console)
- **Note**: Full outline implementation would require a post-processing pass

## Technical Implementation

### Materials
When toon shader is enabled, all materials are converted from MeshStandardMaterial to MeshToonMaterial:
- **Walls** (inner and outer)
- **Floors** and teleport pads
- **Fugitives** (spheres)
- **Chasers** (cubes)

### Gradient Map
The toon effect uses a custom gradient map texture:
- Dynamically generated based on gradient steps
- Uses nearest-neighbor filtering for sharp toon bands
- Grayscale gradient from black to white

### Material Tracking
Each voxel (wall/floor) is tagged with `userData.materialType` to preserve material assignments when toggling between shader types.

## API Reference (Three.js MeshToonMaterial)

### Properties Used
- `color`: Base color of the material
- `gradientMap`: Texture defining the toon shading gradient (key for cel-shading effect)
- `emissive`: Self-illumination color
- `emissiveIntensity`: Strength of self-illumination

### Additional Properties Available
- `map`: Texture map (used for fugitives with team images)
- `transparent`: Enable transparency
- `opacity`: Opacity value (0-1)

## Usage

1. Open `/game/` in a browser
2. Look for the "Rendering Settings" panel in the top-left corner
3. Open the "Toon Shader" folder
4. Check "Enable Toon Shader" to activate cel-shading
5. Adjust "Gradient Steps" to change the toon effect intensity

## Color Preservation
When toggling between standard and toon shaders:
- All custom colors are preserved
- Team images on fugitives are maintained
- Material properties are correctly transferred

## Performance
Toon shader (MeshToonMaterial) is similar in performance to MeshStandardMaterial, as both use the same rendering pipeline with different shading calculations.

## Compatibility with Post-Processing
The toon shader works seamlessly with post-processing effects:
- Can be used together with Bloom for glowing cel-shaded look
- Compatible with FXAA anti-aliasing
- See POST_PROCESSING_FEATURES.md for details on post-processing effects
