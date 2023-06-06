import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { register, unregister } from "https://deno.land/x/denops_std@v5.0.0/lambda/mod.ts";
import { deferred } from "https://deno.land/std@0.190.0/async/deferred.ts";
import { deadline, DeadlineError } from "https://deno.land/std@0.190.0/async/deadline.ts";
import { ensureObject } from "https://deno.land/x/unknownutil@v2.1.1/ensure.ts";

import { ClientName } from "./client.ts";

export const SUPPORTED_METHOD = [
  "textDocument/declaration",
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/documentSymbol",
  "workspace/symbol",
  "workspaceSymbol/resolve",
  "textDocument/prepareCallHierarchy",
  "callHierarchy/incomingCalls",
  "callHierarchy/outgoingCalls",
  "deno/virtualTextDocument",
] as const satisfies readonly string[];

export type Method = typeof SUPPORTED_METHOD[number];

export function isMethod(
  method: string,
): method is Method {
  return SUPPORTED_METHOD.some((m) => method === m);
}

/** Results per client */
export type Results = unknown[];

export async function lspRequest(
  clientName: ClientName,
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
): Promise<Results | null> {
  switch (clientName) {
    case "nvim-lsp":
      return await nvimLspRequest(denops, bufNr, method, params);
    case "coc.nvim":
      return await cocRequest(denops, bufNr, method, params);
    case "vim-lsp":
      return await vimLspRequest(denops, bufNr, method, params);
    default:
      clientName satisfies never;
  }
  return null;
}

async function nvimLspRequest(
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
): Promise<Results | null> {
  const [ok, results] = await denops.call(
    `luaeval`,
    `require('ddu_nvim_lsp').request(_A[1], _A[2], _A[3])`,
    [bufNr, method, params],
  ) as [boolean | null, unknown[]];
  if (!ok) {
    console.log(ok === null ? "No server attached" : `${method} is not supported by any of the servers`);
    return null;
  }
  return results;
}

type CocService = {
  id: string;
  state: string;
  languageIds: string[];
};

async function cocRequest(
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
): Promise<Results | null> {
  const services = await denops.call("CocAction", "services") as CocService[];
  const filetype = await fn.getbufvar(denops, bufNr, "&filetype") as string;
  const activeServiceIds = services.filter((service) =>
    service.state === "running" && service.languageIds.includes(filetype)
  ).map((service) => service.id);
  if (activeServiceIds.length === 0) {
    console.log("No server attached");
    return null;
  }

  let errorCount = 0;
  const results = await Promise.all(activeServiceIds.map(async (clientId) => {
    try {
      return await denops.call("CocRequest", clientId, method, params);
    } catch {
      errorCount++;
    }
  }));
  if (errorCount === activeServiceIds.length) {
    console.log(`${method} is not supported by any of the servers`);
    return null;
  }

  return results.filter((result) => result !== undefined);
}

async function vimLspRequest(
  denops: Denops,
  bufNr: number,
  method: Method,
  params: unknown,
): Promise<Results | null> {
  const servers = await denops.call(
    `lsp#get_allowed_servers`,
    bufNr,
  ) as string[];
  if (servers.length === 0) {
    console.log("No server attached");
    return null;
  }

  let errorCount = 0;
  const results = await Promise.all(servers.map(async (server) => {
    /**
     * Original code is https://github.com/Milly/ddu-source-vimlsp
     * Copyright (c) 2023 Milly
     */
    const data = deferred<unknown>();
    const id = register(denops, (response: unknown) => data.resolve(response));
    try {
      await denops.eval(
        `lsp#send_request(l:server, extend(l:request,` +
          `{'on_notification': {data -> denops#notify(l:name, l:id, [data])}}))`,
        { server, request: { method, params }, name: denops.name, id },
      );
      const resolvedData = await deadline(data, 10_000);
      const { response } = ensureObject(resolvedData);
      const { result } = ensureObject(response);
      return result;
    } catch (e) {
      if (e instanceof DeadlineError) {
        console.log(`No response from server ${server}`);
      } else {
        console.log(e);
        errorCount++;
      }
    } finally {
      unregister(denops, id);
    }
  }));
  if (errorCount === servers.length) {
    console.log(`${method} is not supported by any of the servers`);
    return null;
  }

  return results.filter((result) => result !== undefined);
}
