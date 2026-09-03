/**
 * MOCK OPENAI-COMPATIBLE MODEL — for runtime verification only.
 *
 * Speaks the /v1/models and /v1/chat/completions wire contract so the REAL
 * USTAD AI router, API manager and `generateQuizSet` run unmodified. It returns
 * genuinely varied quiz JSON (never a fixed list), so the "questions must be
 * dynamic" rule is exercised for real.
 *
 * This is a TEST DOUBLE for a third-party API, exactly like scripts/mock-supabase.mjs.
 * No application code is stubbed and nothing here ships to production.
 */
import http from "node:http";

const PORT = Number(process.env["MOCK_OPENAI_PORT"] ?? 8788);

const SUBJECTS = [
  ["Physics", "unit of electrical resistance", ["Ohm", "Volt", "Ampere", "Watt"], 0],
  ["Chemistry", "chemical symbol for gold", ["Ag", "Au", "Gd", "Go"], 1],
  ["Biology", "powerhouse of the cell", ["Nucleus", "Ribosome", "Mitochondria", "Golgi body"], 2],
  ["Geography", "longest river in the world", ["Amazon", "Yangtze", "Ganga", "Nile"], 3],
  ["History", "year India became a republic", ["1947", "1950", "1952", "1935"], 1],
  ["Maths", "value of pi to two decimals", ["3.41", "3.14", "3.12", "3.16"], 1],
  ["Astronomy", "closest planet to the Sun", ["Mercury", "Venus", "Mars", "Earth"], 0],
  ["Literature", "author of the play Hamlet", ["Dickens", "Tolstoy", "Shakespeare", "Keats"], 2],
  ["Sports", "number of players in a cricket team", ["9", "10", "11", "12"], 2],
  ["Technology", "what HTTP stands for at the start", ["Hyper", "Hybrid", "High", "Host"], 0],
];

let salt = 0;

function makeQuestions(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const [category, topic, options, correctIndex] = SUBJECTS[(i + salt) % SUBJECTS.length];
    // A per-call salt guarantees the CONTENT differs between attempts while the
    // COUNT stays exactly what the caller asked for.
    const tag = `set ${salt}-${i + 1}`;
    out.push({
      question: `In ${category} (${tag}), what is the ${topic}?`,
      options: [...options],
      correctIndex,
      difficulty: i / count <= 0.35 ? "easy" : i / count <= 0.7 ? "medium" : "hard",
      category: category.toLowerCase(),
      explanation: `The correct answer is ${options[correctIndex]}.`,
      hint: `Think about basic ${category.toLowerCase()}.`,
    });
  }
  salt += 1;
  return out;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.endsWith("/models")) {
      return send(200, { data: [{ id: "mock-quiz-model" }] });
    }

    if (url.pathname.endsWith("/chat/completions")) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let count = 20;
        try {
          const body = JSON.parse(raw || "{}");
          const text = (body.messages ?? []).map((m) => m.content ?? "").join("\n");
          // The generator states the required count in its prompt.
          const m = text.match(/Create\s+(\d+)\s+fresh/i);
          if (m) count = Number(m[1]);
        } catch {
          /* fall back to 20 */
        }
        count = Math.min(100, Math.max(1, count));
        send(200, {
          model: "mock-quiz-model",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ questions: makeQuestions(count) }) },
            },
          ],
        });
      });
      return;
    }

    send(404, { error: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`mock openai listening on http://127.0.0.1:${PORT}/v1`);
  });
