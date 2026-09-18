'use strict'

/*
  Inserts a class/variant token at the active editor's cursor when a sidebar leaf is double-
  clicked — see Scripts/sidebar-provider.js#insertSelectedClass(). A no-op (not a crash) when
  there's no active text editor, e.g. the user double-clicked with no file open/focused.
*/
exports.insertClass = function insertClass(text) {
  const editor = nova.workspace.activeTextEditor
  if (!editor) return

  editor.edit((e) => {
    e.insert(editor.selectedRange.end, text)
  })
}
