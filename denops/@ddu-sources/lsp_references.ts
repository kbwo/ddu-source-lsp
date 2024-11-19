import { BaseSource, Context, DduItem, Denops, Item, LSP } from "../ddu_source_lsp/deps.ts";
import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { getCwd, locationToItem, printError } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type ReferenceParams = TextDocumentPositionParams & {
  context: LSP.ReferenceContext;
};

type Params = {
  clientName: ClientName | "";
  includeDeclaration: boolean;
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
    const { includeDeclaration } = sourceParams;
    const method: Method = "textDocument/references";

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
              ) as ReferenceParams;
              params.context = { includeDeclaration };
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
          printError(denops, e, "source-lsp_references");
        } finally {
          controller.close();
        }
      },
    });
  }

  params(): Params {
    return {
      clientName: "",
      includeDeclaration: true,
    };
  }
}

function parseResult(
  result: LspResult,
  client: Client,
  bufNr: number,
  method: Method,
  cwd: string,
): Item<ActionData>[] {
  /**
   * Reference:
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_references
   */
  const locations = result as LSP.Location[] | null;
  if (!locations) {
    return [];
  }

  const context = { client, bufNr, method };

  return locations
    .map((location) => locationToItem(location, cwd, context))
    .filter(isValidItem);
}
