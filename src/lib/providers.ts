/**
 * USTAD AI Provider Registry (client-safe metadata only — no keys here).
 * Capability registry drives the AI Router in Part 2.
 */

export type Capability =
  | "text"
  | "reasoning"
  | "coding"
  | "vision"
  | "image-generation"
  | "web-search"
  | "semantic-search"
  | "url-reading"
  | "web-crawling"
  | "ocr"
  | "stt"
  | "tts"
  | "embeddings"
  | "vector-store"
  | "database"
  | "developer";

export type Category =
  | "AI Models"
  | "Search"
  | "Web"
  | "Voice"
  | "Image"
  | "OCR"
  | "Database"
  | "Developer"
  | "Vector Database";

export type FieldDef = {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
};

export type ProviderDef = {
  id: string;
  name: string;
  categories: Category[];
  capabilities: Capability[];
  fields: FieldDef[];
  /** provider can serve chat completions through the router */
  chat?: boolean;
  docs?: string;
};

const key = (required = true): FieldDef => ({
  key: "api_key",
  label: "API Key",
  required,
  secret: true,
  placeholder: "sk-...",
});

export const PROVIDERS: ProviderDef[] = [
  {
    id: "supabase",
    name: "Supabase",
    categories: ["Database"],
    capabilities: ["database"],
    fields: [
      { key: "url", label: "Project URL", required: true, placeholder: "https://xxxx.supabase.co" },
      { key: "anon_key", label: "Anon / Public Key", required: true, secret: true },
      { key: "service_role_key", label: "Service Role Key", required: false, secret: true },
      { key: "project_id", label: "Project ID", required: false },
    ],
  },
  {
    id: "turso",
    name: "Turso",
    categories: ["Database"],
    capabilities: ["database"],
    fields: [
      {
        key: "database_url",
        label: "Database URL",
        required: true,
        placeholder: "https://db-org.turso.io",
      },
      { key: "token", label: "Auth Token", required: true, secret: true },
    ],
  },
  {
    id: "appwrite",
    name: "Appwrite",
    categories: ["Database"],
    capabilities: ["database"],
    fields: [
      {
        key: "endpoint",
        label: "Endpoint",
        required: true,
        placeholder: "https://cloud.appwrite.io/v1",
      },
      { key: "project_id", label: "Project ID", required: true },
      { key: "api_key", label: "API Key", required: false, secret: true },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    categories: ["Developer"],
    capabilities: ["developer"],
    fields: [{ key: "access_token", label: "Access Token", required: true, secret: true }],
  },
  {
    id: "mistral",
    name: "Mistral",
    categories: ["AI Models"],
    capabilities: ["text", "reasoning", "coding", "vision", "embeddings"],
    fields: [
      key(),
      {
        key: "base_url",
        label: "Base URL",
        required: false,
        placeholder: "https://api.mistral.ai/v1",
      },
    ],
    chat: true,
  },
  {
    id: "sambanova",
    name: "SambaNova",
    categories: ["AI Models"],
    capabilities: ["text", "reasoning", "coding"],
    fields: [
      key(),
      {
        key: "base_url",
        label: "Base URL",
        required: false,
        placeholder: "https://api.sambanova.ai/v1",
      },
    ],
    chat: true,
  },
  {
    id: "gemini",
    name: "Gemini",
    categories: ["AI Models", "Image"],
    capabilities: ["text", "reasoning", "coding", "vision", "image-generation", "embeddings"],
    fields: [key()],
    chat: true,
  },
  {
    id: "groq",
    name: "Groq",
    categories: ["AI Models", "Voice"],
    capabilities: ["text", "reasoning", "coding", "stt"],
    fields: [key()],
    chat: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    categories: ["AI Models"],
    capabilities: ["text", "reasoning", "coding", "vision"],
    fields: [key()],
    chat: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    categories: ["AI Models", "Voice", "Image"],
    capabilities: [
      "text",
      "reasoning",
      "coding",
      "vision",
      "image-generation",
      "embeddings",
      "stt",
      "tts",
    ],
    fields: [
      key(),
      { key: "organization_id", label: "Organization ID", required: false },
      {
        key: "base_url",
        label: "Base URL",
        required: false,
        placeholder: "https://api.openai.com/v1",
      },
    ],
    chat: true,
  },
  {
    id: "zhipu",
    name: "Zhipu",
    categories: ["AI Models"],
    capabilities: ["text", "reasoning", "coding", "vision"],
    fields: [key()],
    chat: true,
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    categories: ["Web"],
    capabilities: ["web-crawling", "url-reading"],
    fields: [key()],
  },
  {
    id: "exa",
    name: "EXA",
    categories: ["Search", "Web"],
    capabilities: ["web-search", "semantic-search"],
    fields: [key()],
  },
  {
    id: "jina",
    name: "Jina",
    categories: ["Web", "Search"],
    capabilities: ["url-reading", "embeddings"],
    fields: [key()],
  },
  {
    id: "tavily",
    name: "Tavily",
    categories: ["Search", "Web"],
    capabilities: ["web-search"],
    fields: [key()],
  },
  {
    id: "tensorart",
    name: "Tensor.Art",
    categories: ["Image"],
    capabilities: ["image-generation"],
    fields: [key()],
  },
  {
    id: "replicate",
    name: "Replicate",
    categories: ["Image"],
    capabilities: ["image-generation"],
    fields: [{ key: "api_key", label: "API Token", required: true, secret: true }],
  },
  {
    id: "xai",
    name: "xAI",
    categories: ["AI Models"],
    capabilities: ["text", "reasoning", "coding", "vision"],
    fields: [key()],
    chat: true,
  },
  {
    id: "assemblyai",
    name: "AssemblyAI",
    categories: ["Voice"],
    capabilities: ["stt"],
    fields: [key()],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    categories: ["Voice"],
    capabilities: ["tts"],
    fields: [
      key(),
      { key: "voice_id", label: "Voice ID", required: false, placeholder: "9BWtsMINqrJLrRacOk9x" },
    ],
  },
  {
    id: "deepgram",
    name: "Deepgram",
    categories: ["Voice"],
    capabilities: ["stt", "tts"],
    fields: [key()],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    categories: ["AI Models"],
    capabilities: ["text", "reasoning", "coding"],
    fields: [key()],
    chat: true,
  },
  {
    id: "cohere",
    name: "Cohere",
    categories: ["AI Models", "Search"],
    capabilities: ["text", "embeddings", "semantic-search"],
    fields: [key()],
    chat: true,
  },
  {
    id: "chroma",
    name: "Chroma",
    categories: ["Vector Database"],
    capabilities: ["vector-store"],
    fields: [
      { key: "url", label: "Server URL", required: true, placeholder: "https://your-chroma-host" },
      { key: "token", label: "Token", required: false, secret: true },
      { key: "tenant", label: "Tenant", required: false },
      { key: "database_id", label: "Database", required: false },
    ],
  },
  {
    id: "qdrant",
    name: "Qdrant",
    categories: ["Vector Database"],
    capabilities: ["vector-store"],
    fields: [
      { key: "url", label: "Cluster URL", required: true, placeholder: "https://xxxx.qdrant.io" },
      { key: "api_key", label: "Cluster Key", required: true, secret: true },
    ],
  },
  {
    id: "pinecone",
    name: "Pinecone",
    categories: ["Vector Database"],
    capabilities: ["vector-store"],
    fields: [
      key(),
      {
        key: "url",
        label: "Index Host URL",
        required: false,
        placeholder: "https://index-xxxx.svc.region.pinecone.io",
      },
      { key: "region", label: "Region", required: false },
    ],
  },
  {
    id: "spaceocr",
    name: "Space OCR",
    categories: ["OCR"],
    capabilities: ["ocr"],
    fields: [key()],
  },
];

export const CATEGORIES: Category[] = [
  "AI Models",
  "Search",
  "Web",
  "Voice",
  "Image",
  "OCR",
  "Database",
  "Developer",
  "Vector Database",
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const STATUS_LABELS: Record<string, string> = {
  not_configured: "Not Configured",
  saved_not_tested: "Saved / Not Tested",
  testing: "Testing",
  connected: "Connected",
  invalid_credentials: "Invalid Credentials",
  missing_field: "Missing Required Field",
  unauthorized: "Unauthorized",
  rate_limited: "Rate Limited",
  quota_exceeded: "Quota Exceeded",
  provider_unavailable: "Provider Unavailable",
  network_error: "Network Error",
  failed: "Connection Failed",
};
