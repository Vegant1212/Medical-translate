import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

function openAiProxy(apiKey: string, model: string): Plugin {
  return {
    name: "medical-translate-openai-proxy",
    configureServer(server) {
      server.middlewares.use("/api/openai/chat", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: { message: "Método no permitido." } }));
          return;
        }

        if (!apiKey) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: { message: "Falta OPENAI_API_KEY en .env.local." } }));
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            messages?: { role: "system" | "user" | "assistant"; content: string }[];
            max_tokens?: number;
          };

          const upstream = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              input: body.messages ?? [],
              max_output_tokens: body.max_tokens ?? 8000,
              reasoning: { effort: "low" },
              text: { verbosity: "low" },
            }),
          });

          const data = (await upstream.json()) as {
            error?: { message?: string };
            output_text?: string;
            output?: { content?: { type?: string; text?: string }[] }[];
          };

          if (!upstream.ok) {
            response.statusCode = upstream.status;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: { message: data.error?.message ?? "OpenAI rechazó la solicitud." } }));
            return;
          }

          const content =
            data.output_text ??
            data.output
              ?.flatMap((item) => item.content ?? [])
              .filter((item) => item.type === "output_text" || typeof item.text === "string")
              .map((item) => item.text ?? "")
              .join("") ??
            "";

          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ choices: [{ message: { content } }] }));
        } catch (error) {
          console.error("OpenAI proxy failed", error);
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: { message: "No se pudo conectar con OpenAI." } }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), openAiProxy(env.OPENAI_API_KEY, env.OPENAI_MODEL || "gpt-5.6-terra")],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Never expose OPENAI_API_KEY to browser code.
    envPrefix: ["VITE_", "EXPO_PUBLIC_"],
  };
});
