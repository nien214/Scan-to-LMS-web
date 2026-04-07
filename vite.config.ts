import { promises as fs } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";

const repoName = "Scan-to-LMS-web";
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === "true";
const base = isGitHubPagesBuild ? `/${repoName}/` : "/";
const PROCESSED_DATABASE_UPLOAD_PATTERN =
  /^processed-database\.uploaded\.(csv|xlsx|xls)$/i;

async function readRequestBody(request: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    request.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
    });
    request.on("error", (error: unknown) => {
      reject(error);
    });
  });
}

function processedDatabaseMirrorPlugin() {
  const registerHandler = (server: any) => {
    server.middlewares.use("/api/processed-database", async (request: any, response: any, next: () => void) => {
      if (request.method !== "POST") {
        next();
        return;
      }

      try {
        const payload = JSON.parse(await readRequestBody(request)) as {
          contentBase64?: string;
          fileName?: string;
        };
        const fileName = payload.fileName?.trim() ?? "";
        const contentBase64 = payload.contentBase64?.trim() ?? "";
        const extension = path.extname(fileName).toLowerCase();

        if (![".csv", ".xlsx", ".xls"].includes(extension) || !contentBase64) {
          response.statusCode = 400;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error: "Upload a CSV or Excel file.",
            }),
          );
          return;
        }

        const componentsDirectory = path.resolve(__dirname, "src/components");
        const currentFiles = await fs.readdir(componentsDirectory);

        await Promise.all(
          currentFiles
            .filter((entry) => PROCESSED_DATABASE_UPLOAD_PATTERN.test(entry))
            .map((entry) =>
              fs.rm(path.join(componentsDirectory, entry), { force: true }),
            ),
        );

        const mirroredFileName = `processed-database.uploaded${extension}`;
        await fs.writeFile(
          path.join(componentsDirectory, mirroredFileName),
          Buffer.from(contentBase64, "base64"),
        );

        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            fileName: mirroredFileName,
            path: `src/components/${mirroredFileName}`,
          }),
        );
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "Unable to save the uploaded database.",
          }),
        );
      }
    });
  };

  return {
    name: "processed-database-mirror",
    configureServer: registerHandler,
    configurePreviewServer: registerHandler,
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    processedDatabaseMirrorPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Scan to LMS",
        short_name: "Scan to LMS",
        description: "Scan ISBN barcodes, review catalog details, and sync books to Supabase.",
        theme_color: "#ef5847",
        background_color: "#f5efe5",
        display: "standalone",
        orientation: "portrait",
        scope: base,
        start_url: base,
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
