# Post-Processing Effects Features

## Overview
Integrated professional-grade post-processing effects from the klp project into the /game/ page, using Three.js EffectComposer pipeline.

## Features Added

### 1. Post-Processing System
- **EffectComposer**: Manages the rendering pipeline with multiple effect passes
- **RenderPass**: Base scene rendering pass
- **OutputPass**: Final color correction and output pass
- **Multi-sampling**: 4x MSAA for smooth edges on render target

### 2. Bloom Effect (UnrealBloomPass)
Based on Unreal Engine's bloom implementation - creates a beautiful glow effect for bright areas.

#### Controls
- **Enable Bloom**: Toggle the bloom effect on/off
- **Threshold** (0-1, default 0.5): 
  - Controls which pixels glow
  - Lower = more pixels glow
  - Higher = only brightest pixels glow
- **Strength** (0-3, default 0.4):
  - Intensity of the glow
  - Higher = stronger glow effect
- **Radius** (0-1, default 1.0):
  - Size of the glow halo
  - Higher = larger, softer glow

#### Best Settings for Different Looks
- **Subtle Enhancement**: threshold: 0.7, strength: 0.3, radius: 0.5
- **Dramatic Glow**: threshold: 0.3, strength: 1.5, radius: 1.0
- **Neon/Cyberpunk**: threshold: 0.2, strength: 2.0, radius: 0.8
- **KLP Style** (from source): threshold: 0.5, strength: 0.4, radius: 1.0

### 3. FXAA Anti-Aliasing
Fast Approximate Anti-Aliasing - smooths jagged edges efficiently.

#### Features
- **Enable FXAA**: Toggle anti-aliasing on/off
- Automatically adjusts to screen resolution and pixel ratio
- Lightweight compared to traditional MSAA
- Works well with bloom effect

### 4. GUI Integration
All post-processing controls are in the "Post-Processing Effects" folder:
- **Bloom (Glow)** sub-folder with all bloom parameters
- **FXAA Anti-Aliasing** checkbox
- Folder is open by default for easy access
- Real-time parameter updates

## Technical Implementation

### Architecture
```
Scene Render → RenderPass → [BloomPass] → [FXAAPass] → OutputPass → Screen
```

### Files Copied from klp Project
**Postprocessing:**
- `EffectComposer.js` - Main composer system
- `RenderPass.js` - Scene rendering pass
- `UnrealBloomPass.js` - Bloom effect
- `OutputPass.js` - Final output with tone mapping
- `Pass.js` - Base pass class
- `ShaderPass.js` - Generic shader pass
- `FXAAPass.js` - Anti-aliasing pass

**Shaders:**
- `CopyShader.js` - Simple copy shader
- `LuminosityHighPassShader.js` - High-pass filter for bloom
- `FXAAShader.js` - FXAA shader implementation

### Dynamic Pass Management
Effects are dynamically added/removed based on settings:
- Passes are rebuilt when effects are enabled/disabled
- Optimal performance - only active effects are processed
- Proper disposal of old passes when updating

### Render Pipeline
- When post-processing is disabled: Direct `renderer.render()` (fastest)
- When post-processing is enabled: `composer.render()` (with effects)
- Camera updates automatically propagate to RenderPass
- Works with both orthographic and perspective cameras

### Integration with Existing Features
- Compatible with toon shader
- Works with material switching
- Respects camera zoom and position
- Handles window resize properly
- Updates on camera type changes

## Usage

1. Open `/game/` in a browser
2. Look for "Post-Processing Effects" folder in the GUI (top-left)
3. **For Bloom:**
   - Check "Enable Bloom"
   - Adjust threshold to control which areas glow
   - Adjust strength for glow intensity
   - Adjust radius for glow size
4. **For Anti-Aliasing:**
   - Check "FXAA Anti-Aliasing" for smooth edges

## Performance Considerations

### Bloom Effect
- **Performance**: Moderate impact (~5-15% depending on resolution)
- **Optimization**: Uses half-float render target for better performance
- **Recommendation**: Use lower strength/radius for better FPS on slower devices

### FXAA
- **Performance**: Minimal impact (~2-5%)
- **Quality**: Fast and effective edge smoothing
- **Recommendation**: Enable by default for better visuals

### Combined Effects
- Both effects can run together
- Total performance impact: ~10-20% depending on settings
- Still maintains good FPS on modern hardware

## Comparison with klp Project

### Similarities
- Same bloom parameters and defaults
- Same EffectComposer pipeline
- Same UnrealBloomPass implementation

### Differences
- jagad uses lil-gui, klp uses A-Frame component system
- jagad has dynamic pass management, klp has static setup
- jagad adds FXAA option, klp doesn't have it
- jagad supports both orthographic and perspective cameras

## Future Enhancement Ideas

Additional effects available in klp that could be added:
- **DotScreenPass**: Comic book/halftone effect
- **FilmPass**: Film grain and scanlines
- **GlitchPass**: Digital glitch effect
- **OutlinePass**: Object outline rendering
- **SSAOPass**: Screen-space ambient occlusion
- **SSRPass**: Screen-space reflections
- **HalftonePass**: Halftone print effect

## Troubleshooting

### Bloom not visible
- Check if "Enable Bloom" is checked
- Lower the threshold (try 0.3 or less)
- Increase the strength (try 1.0 or more)
- Ensure emissive materials have intensity > 0

### Performance issues
- Disable bloom or reduce strength/radius
- Lower the render resolution in browser
- Disable other heavy effects

### Effects not working after resize
- Should work automatically
- Check console for errors
- Try refreshing the page

## Credits
- Post-processing implementation inspired by klp project
- Three.js examples and documentation
- Unreal Engine bloom algorithm
