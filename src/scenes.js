// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`), keyed like the manifest. Their
// keys are frozen once published.
//
// - recall_preset: what the remote's preset buttons do, for a wake-up radio
//   or a "dinner" playlist. Gladys has no device command to pass a number to
//   a select, hence the action.
// - select_input: switch a zone to an input by its id or by the name the
//   device shows ("hdmi1" or "Apple TV"), turning the zone on first.
//
// A scene action has no user language: its errors (written in the Gladys
// logs) follow the configured language.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  recall_preset: async (hub, fields) => {
    const preset = await hub.recallPreset(fields.device, Number(fields.preset));
    return { preset_name: preset.name };
  },
  select_input: async (hub, fields) => {
    const { name } = await hub.selectInput(fields.device, fields.input);
    return { input_name: name };
  },
};
