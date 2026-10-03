import type { ClientModule } from 'claude-code'

/**
 * The key strip: draws the shortcut hint and forwards every key to the hooks
 * module, which owns what each key does (keymap.ts).
 */
const KeyStrip: ClientModule<{ hint: string }> = (props, surface) => {
  const { Box, Text } = surface.elements
  surface.onKey(k =>
    surface.post({ key: k.key, shift: k.shift === true, ctrl: k.ctrl === true, meta: k.meta === true }),
  )

  return (
    <Box>
      <Text dimColor wrap="truncate-end">
        ⌨ {props.hint}
      </Text>
    </Box>
  )
}

export default KeyStrip
