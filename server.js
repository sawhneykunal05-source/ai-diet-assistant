const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const TOKEN_SECRET = process.env.TOKEN_SECRET || "change-this-token-secret";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const USDA_API_KEY = process.env.USDA_API_KEY || "";

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const FALLBACK_FOODS = [
  { name: "Chicken Breast, roasted", calories: 165, protein: 31, serving: "100g" },
  { name: "Egg, whole", calories: 143, protein: 13, serving: "100g" },
  { name: "Oats, dry", calories: 389, protein: 17, serving: "100g" },
  { name: "Brown Rice, cooked", calories: 123, protein: 2.7, serving: "100g" },
  { name: "Greek Yogurt, plain", calories: 59, protein: 10, serving: "100g" },
  { name: "Paneer", calories: 265, protein: 18, serving: "100g" }
];

ensureDataFiles();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      return handleRegister(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      return handleLogin(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/profile") {
      return handleGetProfile(req, res);
    }
    if (req.method === "PUT" && url.pathname === "/api/profile") {
      return handleUpdateProfile(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/nutrition/search") {
      return handleNutritionSearch(url, res);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/nutrition/barcode/")) {
      const code = url.pathname.split("/").pop();
      return handleBarcodeLookup(code, res);
    }

    return serveStatic(req, res, url.pathname);
  } catch (err) {
    return json(res, 500, { error: `Server error: ${err.message}` });
  }
});

server.listen(PORT, () => {
  console.log(`AI Diet Assistant server running on http://localhost:${PORT}`);
});

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]", "utf8");
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error("Payload too large"));
        req.socket.destroy();
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(`${header}.${body}`).digest("base64url");
  if (expected !== signature) return null;
  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (decoded.exp && Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

function getUserFromAuth(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded?.email) return null;
  const users = readUsers();
  return users.find((u) => u.email === decoded.email) || null;
}

async function handleRegister(req, res) {
  const body = await parseBody(req);
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");

  if (!email || !email.includes("@") || password.length < 6) {
    return json(res, 400, { error: "Invalid email or password too short." });
  }

  const users = readUsers();
  if (users.some((u) => u.email === email)) {
    return json(res, 409, { error: "Email already registered." });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  users.push({
    email,
    salt,
    passwordHash,
    profile: { age: 28, gender: "male", height: 170, weight: 72, activity: 1.375, goal: "maintain" },
    createdAt: Date.now()
  });
  writeUsers(users);

  const token = signToken({ email, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 });
  return json(res, 201, { token, email });
}

async function handleLogin(req, res) {
  const body = await parseBody(req);
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");

  const users = readUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return json(res, 401, { error: "Invalid credentials." });

  const candidate = hashPassword(password, user.salt);
  if (candidate !== user.passwordHash) return json(res, 401, { error: "Invalid credentials." });

  const token = signToken({ email, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 });
  return json(res, 200, { token, email });
}

function handleGetProfile(req, res) {
  const user = getUserFromAuth(req);
  if (!user) return json(res, 401, { error: "Unauthorized" });
  return json(res, 200, { profile: user.profile || {} });
}

async function handleUpdateProfile(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const decoded = token ? verifyToken(token) : null;
  if (!decoded?.email) return json(res, 401, { error: "Unauthorized" });

  const body = await parseBody(req);
  const profile = body.profile || {};
  const users = readUsers();
  const idx = users.findIndex((u) => u.email === decoded.email);
  if (idx === -1) return json(res, 401, { error: "Unauthorized" });

  users[idx].profile = {
    age: Number(profile.age || 28),
    gender: profile.gender === "female" ? "female" : "male",
    height: Number(profile.height || 170),
    weight: Number(profile.weight || 72),
    activity: Number(profile.activity || 1.375),
    goal: ["lose", "gain", "maintain"].includes(profile.goal) ? profile.goal : "maintain"
  };
  writeUsers(users);
  return json(res, 200, { ok: true });
}

async function handleChat(req, res) {
  const body = await parseBody(req);
  const message = String(body.message || "").trim();
  const context = String(body.context || "");
  if (!message) return json(res, 400, { error: "Message is required." });

  if (!GROQ_API_KEY) return json(res, 500, { error: "Missing GROQ_API_KEY." });

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a nutrition and fitness coach. Be concise, practical, and safe. No diagnosis."
          },
          {
            role: "user",
            content: `User context: ${context}\nQuestion: ${message}`
          }
        ],
        max_tokens: 320,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return json(res, response.status, { error: `Groq error: ${errorText.slice(0, 300)}` });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "No response from AI.";
    return json(res, 200, { reply });
  } catch (err) {
    return json(res, 500, { error: `Chat request failed: ${err.message}` });
  }
}

async function handleNutritionSearch(url, res) {
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return json(res, 400, { error: "q is required." });

  try {
    if (USDA_API_KEY) {
      const apiRes = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(USDA_API_KEY)}&query=${encodeURIComponent(query)}&pageSize=20`);
      if (apiRes.ok) {
        const data = await apiRes.json();
        const items = (data.foods || []).map(mapUsdaFood).filter(Boolean);
        return json(res, 200, { items });
      }
    }

    const fallback = FALLBACK_FOODS.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));
    return json(res, 200, { items: fallback });
  } catch (err) {
    return json(res, 500, { error: `Nutrition search failed: ${err.message}` });
  }
}

async function handleBarcodeLookup(code, res) {
  if (!code) return json(res, 400, { error: "Barcode is required." });

  try {
    if (USDA_API_KEY) {
      const usda = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(code)}?api_key=${encodeURIComponent(USDA_API_KEY)}`);
      if (usda.ok) {
        const data = await usda.json();
        return json(res, 200, { item: mapUsdaFood(data) });
      }
    }

    const off = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
    if (off.ok) {
      const data = await off.json();
      const p = data.product;
      if (p) {
        const item = {
          name: p.product_name || p.generic_name || `Barcode ${code}`,
          calories: Number(p.nutriments?.["energy-kcal_100g"] || 0),
          protein: Number(p.nutriments?.proteins_100g || 0),
          serving: "100g"
        };
        return json(res, 200, { item });
      }
    }

    return json(res, 404, { error: "No product found." });
  } catch (err) {
    return json(res, 500, { error: `Barcode lookup failed: ${err.message}` });
  }
}

function mapUsdaFood(food) {
  if (!food) return null;

  const nutrients = food.foodNutrients || [];
  const getNutrient = (name, number) => {
    for (const n of nutrients) {
      if (n.nutrientName === name || n.nutrient?.name === name || n.nutrientNumber === number || n.nutrient?.number === number) {
        return Number(n.value || n.amount || 0);
      }
    }
    return 0;
  };

  return {
    name: food.description || food.lowercaseDescription || "Unknown food",
    calories: getNutrient("Energy", "208"),
    protein: getNutrient("Protein", "203"),
    serving: "100g"
  };
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(__dirname, filePath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

