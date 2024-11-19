import { BaseSource, Context, DduItem, Denops, Item, LSP } from "../ddu_source_lsp/deps.ts";
import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makePositionParams } from "../ddu_source_lsp/params.ts";
import { getCwd, locationToItem, printError } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type Params = {
  clientName: ClientName | "";
  method: Extract<
    Method,
    | "textDocument/definition"
    | "textDocument/declaration"
    | "textDocument/typeDefinition"
    | "textDocument/implementation"
  >;
};

export class Source extends BaseSource<Params> {
  kind = "lsp";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
    context: Context;
    input: string;
    parent?: DduItem;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams, context: ctx } = args;
    const { method } = sourceParams;

    return new ReadableStream({
      async start(controller) {
        try {
          const clientName = await getClientName(denops, sourceParams);
          const clients = await getClients(denops, clientName, ctx.bufNr);
          const cwd = await getCwd(denops, ctx.winId);

          await Promise.all(clients.map(async (client) => {
            const isSupported = await denops.call(
                "luaeval",
                "vim.lsp.get_client_by_id(_A[1]).supports_method(_A[2])",
                [client.id, method],
              )
            if (isSupported) {
              const params = await makePositionParams(
                denops,
                ctx.bufNr,
                ctx.winId,
                client.offsetEncoding,
              );
              const result = await lspRequest(
                denops,
                client,
                method,
                params,
                ctx.bufNr,
              );
              const items = parseResult(result, client, ctx.bufNr, method, cwd);
              controller.enqueue(items);
            }
          }));
        } catch (e) {
          printError(denops, e, "source-lsp_definition");
        } finally {
          controller.close();
        }
      },
    });
  }

  params(): Params {
    return {
      clientName: "",
      method: "textDocument/definition",
    };
  }
}

export function parseResult(
  result: LspResult,
  client: Client,
  bufNr: number,
  method: Method,
  cwd: string,
): Item<ActionData>[] {
  /**
   * References:
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_declaration
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_definition
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_typeDefinition
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_implementation
   */
  const _location = result as
    | LSP.Location
    | LSP.Location[]
    | LSP.LocationLink[]
    | null;
  if (!_location) {
    return [];
  }

  const locations = Array.isArray(_location) ? _location : [_location];
  const context = { client, bufNr, method };

  return locations
    .map((location) => locationToItem(location, cwd, context))
    .filter(isValidItem);
}
