import { Hono } from "hono";
import { extractVidbasic } from "./providers/vidbasic";
import type { Source } from "./types/sources";
import { handleHlsProxy } from "./proxy/index";
const app = new Hono<{ Bindings: CloudflareBindings }>();
app.get("/", (c) => c.text("what are you doing here?"));
app.options("/sources", (c) =>
  c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  })
);
app.options("/hls/:encoded", (c) =>
  c.body(null, 200, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Max-Age": "86400",
  })
);
app.get("/hls/:encoded", async (c) => {
  return handleHlsProxy(c.req.raw);
});

app.get('/status', (c) => c.json({ 
  success: true, 
  data: "ok" 
}));


app.get("/sources", async (c) => {
  const id = c.req.query("id")!;
  try {
    let data: Source | null = null;
    switch ("vb") {
      case "vb":
        data = await extractVidbasic(id!);
        break;
      default:
        return c.json(
          { success: false, error: `Unknown host: vb` },
          404,
          { "Access-Control-Allow-Origin": "*" }
        );
    }
    return c.json(
      { success: true, host: "vb", id, data },
      200,
      { "Access-Control-Allow-Origin": "*" }
    );
  } catch (err: any) {
    const message = err?.message || "Internal error";
    return c.json(
      { success: false, error: message },
      500,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
});

export default app;