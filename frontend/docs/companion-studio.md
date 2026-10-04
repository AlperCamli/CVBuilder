# Companion Studio

In local development, open `/designs/guided-journey/editor`, or use **Tune companion** in the combined design's review bar.

The studio previews the actual landing and pricing pages. It uses the existing mascot artwork, CV renderer, and demo interactions. The editor is a separate design-review route; the original public pages and earlier alternatives are preserved.

The editor and earlier alternatives are kept in Git but excluded from default production builds. `VITE_ENABLE_DESIGN_TOOLS=true` enables a dedicated review build. The public `/guided-journey` pages always use committed defaults and ignore browser-local Studio settings. Future published tuning requires exporting, validating, and committing the configuration.

## A practical way to configure it

1. Select **Welcome**, **Demo**, **Pricing**, **Closing**, or **Return to top**. The preview moves to that part of the page. Return to top previews the pointing pose beside Start free.
2. Under **Position**, drag the mascot or the body of its bubble. Use the sliders or exact number fields for precise adjustments. Character size, facing direction, bubble placement, width, and independent bubble offsets are configurable. Offsets are relative to responsive section anchors, rather than absolute page coordinates. **Automatic · face inward** mirrors every expression when the mascot is on the right; at the return stop it points toward Start free. Explicit left/right overrides apply to every expression at that stop, including on compact screens.
3. Under **Dialogue**, choose a situation or reaction, edit its text, pick an expression, and configure its primary button and secondary link. **Being picked up** and **After being moved** control the visitor drag reactions. **Hold this message in preview** lets you inspect a specific message; switch it off to follow real scrolling and demo actions. Messages can also be disabled. Text supports line breaks.
4. Under **Motion**, try Quiet, Friendly, or Lively, then adjust follow softness, idle bob/cycle, movement lean, reaction duration, the pause after typing, and repeat-reaction cooldown. Positive transition offsets begin movement earlier; negative offsets wait longer. Disable drag handles to preview follow softness.
5. Use the timeline to scrub the page, **Play scroll** to move downward, or the reverse button to move upward. Scrolling inside the preview also works and pauses playback. Motion preferences are respected.
6. Under **Mobile**, choose a corner, size, bottom spacing, and bubble width. Select a phone or tablet viewport to inspect the compact version. Below 1360px, the bubble opens on tap and the companion hides while typing or in a modal.

The desktop preview renders at its stated viewport width even when scaled to fit your screen. Use the zoom control for a closer look. Undo/redo cover settings, drags, imports, and resets; a continuous drag is treated as one undo step. An overlap notice flags positions that cover a pricing card or the demo workspace.

## Saving and sharing

- **Draft saved locally**: changes save automatically in this browser. Reloading recovers the draft.
- **Use on review pages**: applies the draft to the combined landing and pricing pages in this browser. Open review pages update without resetting their demo state. This does not publish changes or change another visitor's experience.
- **Export JSON**: downloads all positions, dialogue, actions, motion, and compact settings. Keep this file as a version or share it for implementation.
- **Import**: restores an exported version. Unsupported or malformed files are rejected without replacing the current draft. Imported numeric values are bounded.
- **Reset draft**: restores the original configuration in the editor; undo can recover the previous draft.
- **Restore review defaults**: removes the locally applied override while retaining the draft in the editor.

Exports use schema version 1. Storage keys are `jobspecificcv:companion-studio:draft:v1` and `jobspecificcv:companion-studio:applied:v1`. Local browser data can be cleared by the browser, so export configurations you want to keep or move to another device.

Existing version 1 drafts and exports remain compatible. Missing facing and drag-reaction fields receive defaults without replacing any saved positions, dialogue, or timing. A screenshot cannot recover exact values; export the JSON when sharing a configuration for implementation.

## Preview behavior

Editing companion settings does not reset the CV demo. Changing between the landing and pricing preview loads that page afresh. Preview buttons that scroll or open trial details work; signup, paid signup, and external navigation show a status message instead of leaving the editor or recording checkout intent. The normal review pages retain their existing signup and trial flows.

Default motion adds a restrained 2px idle bob, 140ms following softness, and up to 1.5° of movement lean. The position track still uses animation-frame transforms rather than React state updates for each scroll frame. The bubble is an independent opaque layer, and both layers update when the viewport, section geometry, or message size changes.

On public and review pages, visitors can drag the character with a mouse or touch. It gives a playful pickup reaction, keeps its bubble within the viewport, and stays where dropped through scrolling within the current section. Visitors can move it again as often as needed. It rejoins the configured rail when scrolling reaches a different section destination (welcome, demo, pricing, or closing), in either direction. The welcome and return-to-top poses count as one destination. Demo tabs and reaction changes do not release a parked character, and crossing a section while actively dragging never interrupts the drag. Keyboard users can focus the character and use arrow keys to move it, then Escape to return it. These moves never write to saved settings. Reduced motion suppresses the pickup wobble and rail smoothing. A parked position survives window blur and resizing (clamped to the screen); opening a modal or cancelling an active drag still releases the move.

To test visitor dragging inside Studio, turn off **Drag handles in preview** and **Hold this message in preview**. With drag handles on, moves continue to edit the saved stop offsets as before. **Explore plans**, pricing hash links, and Studio's Pricing stop now align the billing controls near the top, bringing the actual cards into view without changing their geometry.

## Implementation

- `src/app/pages/designs/MascotStudio.tsx`: editor, controls, undo/redo, local draft, import/export, and scaled live preview.
- `src/app/pages/designs/mascot-config.ts`: typed versioned defaults, validation, and local settings loading.
- `src/app/pages/designs/useMascotSettings.ts`: same-origin preview bridge, playback, drag handling, and review-page settings.
- `src/app/pages/designs/MascotRail.tsx`: responsive configured rail, dialogue, poses, and motion.
- `src/app/pages/designs/useMascotDrag.ts`: temporary visitor movement, pointer capture/cancellation, keyboard movement, and pickup/drop reactions.
- `src/app/pages/designs/mascot-navigation.ts`: shared scrolling target for the demo and pricing actions.
- `src/app/pages/designs/mascot-config.test.ts`: portable configuration and storage validation tests.

No backend, authentication, billing-price, or public API changes are involved.

## Verification

- Production client/SSR build and prerender passed; all 60 tests passed, including six configuration validation/storage tests and compatibility with earlier exports.
- Browser checks covered numeric edits, dragging in a scaled iframe, bubble dragging, expressions, section navigation, undo/redo, preserved CV edits, trial dialogs, and preview navigation protection.
- Verified draft recovery, cross-tab applied settings, JSON export/import, invalid-file rejection, and restoring review defaults without deleting the draft.
- Verified compact positioning, forward/reverse playback controls, pause, reduced motion, and the editor at desktop and phone widths, with no browser runtime errors.
- Rechecked both combined review pages from 320px to 1440px, existing signup/trial intents, the original closing copy and pricing geometry, and previous alternatives. A continuous 156-position check in each scroll direction confirmed the default motion remains clear of demo controls and preserves keyboard focus.
- Checked visitor drag/drop, reaction timing, scroll release, edge clamping, keyboard repositioning/Escape, all mirrored poses, per-stop direction overrides, preserved configuration and CV edits, and pricing navigation on desktop, tablet, and phones. Rechecked reduced motion, trial/signup intents, unchanged pricing geometry/closing copy, earlier alternatives, and Studio import/export, permanent dragging, and draft recovery.
- Verified destination-based release after repeated drops: small forward/backward scrolls, demo edits/tabs, and interpolated size/bubble settings preserve the parked position. Arrival at demo, pricing, closing, or welcome releases it; welcome and the return-to-top pose share a destination. Also checked section crossings during active dragging, reduced motion, Escape, viewport-height changes, and compact layouts at 768px, 390px, and 320px.
