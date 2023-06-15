import { Denops, fn } from "https://deno.land/x/ddu_vim@v3.0.2/deps.ts";
import {
  CodeActionContext,
  Position,
  Range,
  TextDocumentIdentifier,
} from "npm:vscode-languageserver-types@3.17.4-next.0";

import { getProperDiagnostics } from "../@ddu-sources/lsp_diagnostic.ts";
import { Client } from "./client.ts";
import { bufNrToFileUri } from "./util.ts";
import { vimGetCursor, vimSelectRange } from "./vim.ts";
import { encodeUtfPosition, OffsetEncoding } from "./offset_encoding.ts";

export type TextDocumentPositionParams = {
  /** The text document. */
  textDocument: TextDocumentIdentifier;
  /** The position inside the text document. */
  position: Position;
};

export async function makePositionParams(
  denops: Denops,
  bufNr: number,
  winId: number,
  offsetEncoding?: OffsetEncoding,
): Promise<TextDocumentPositionParams> {
  const cursorPos = await vimGetCursor(denops, winId);
  return {
    textDocument: await makeTextDocumentIdentifier(denops, bufNr),
    position: await encodeUtfPosition(denops, bufNr, cursorPos, offsetEncoding),
  };
}

export async function makeTextDocumentIdentifier(
  denops: Denops,
  bufNr: number,
): Promise<TextDocumentIdentifier> {
  return {
    uri: await bufNrToFileUri(denops, bufNr),
  };
}

type CodeActionParams = {
  textDocument: TextDocumentIdentifier;
  range: Range;
  context: CodeActionContext;
};

export async function makeCodeActionParams(
  denops: Denops,
  bufNr: number,
  winId: number,
  clilent: Client,
): Promise<CodeActionParams> {
  const textDocument = await makeTextDocumentIdentifier(denops, bufNr);
  const range = await getSelectionRange(denops, bufNr, winId, clilent.offsetEncoding);
  const diagnostics = await getProperDiagnostics(clilent.name, denops, bufNr);

  return {
    textDocument,
    range: {
      start: await encodeUtfPosition(denops, bufNr, range.start),
      end: await encodeUtfPosition(denops, bufNr, range.end),
    },
    context: { diagnostics: diagnostics ?? [] },
  };
}

async function getSelectionRange(
  denops: Denops,
  bufNr: number,
  winId: number,
  offsetEncoding?: OffsetEncoding,
): Promise<Range> {
  const range = await vimSelectRange(denops, winId);
  const encodedRange = {
    start: await encodeUtfPosition(denops, bufNr, range.start, offsetEncoding),
    end: await encodeUtfPosition(denops, bufNr, range.end, offsetEncoding),
  };

  const mode = await fn.mode(denops);
  if (mode === "V") {
    encodedRange.start.character = 0;
    encodedRange.end.character = Number.MAX_SAFE_INTEGER;
  }

  return encodedRange;
}
