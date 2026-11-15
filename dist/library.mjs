import { supabaseUrl, supabasePublishableKey } from "./sync-config.mjs";

const byId = id => document.getElementById(id);
const section = byId("library");
const status = byId("library-status");
const games = byId("saved-games");
const save = byId("save-game");
const title = byId("game-title");
const pgn = byId("pgn");
let userId;
let pendingSave;
let busy = false;
let revision = 0;

function showSession(session) {
  const nextId = session?.user.id;
  if (userId !== nextId) {
    pendingSave = undefined;
    games.replaceChildren();
    revision++;
  }
  userId = nextId;
  byId("sign-in").hidden = !!userId;
  byId("sign-out").hidden = !userId;
  byId("save-form").hidden = !userId;
  games.hidden = !userId;
  updateSaveButton();
}

function updateSaveButton() {
  save.disabled = busy || !userId || !pgn.textContent;
}

function renderGame(game, remove) {
  const item = document.createElement("li");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = game.title;
  const body = document.createElement("pre");
  body.textContent = game.pgn;
  const download = document.createElement("button");
  download.type = "button";
  download.textContent = "Download PGN";
  download.onclick = () => {
    const url = URL.createObjectURL(new Blob([game.pgn], { type: "application/x-chess-pgn" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = (game.title.replace(/[^\p{L}\p{N}-]+/gu, "-") || "game") + ".pgn";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "secondary";
  deleteButton.textContent = "Delete game";
  deleteButton.onclick = () => {
    if (window.confirm("Delete this saved PGN?")) void remove(game.id);
  };
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(download, deleteButton);
  details.append(summary, body, actions);
  item.append(details);
  return item;
}

async function initialize() {
  if (!supabaseUrl || !supabasePublishableKey) return;
  section.hidden = false;
  byId("library-link").hidden = false;
  status.textContent = "Connecting to your game library…";
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm");
  const client = createClient(supabaseUrl, supabasePublishableKey, { auth: { flowType: "pkce" } });

  async function refresh(message) {
    if (!userId) return;
    const current = ++revision;
    const { data, error } = await client.from("saved_games").select("id,title,pgn,created_at").order("created_at", { ascending: false });
    if (current !== revision) return;
    if (error) {
      status.textContent = error.message;
      return;
    }
    games.replaceChildren(...data.map(game => renderGame(game, remove)));
    status.textContent = message || (data.length ? "" : "No saved games yet.");
  }

  async function remove(id) {
    if (!userId || busy) return;
    const account = userId;
    const { error } = await client.from("saved_games").delete().eq("id", id);
    if (account !== userId) return;
    if (error) status.textContent = error.message;
    else await refresh("Game deleted.");
  }

  client.auth.onAuthStateChange((event, session) => {
    const changed = userId !== session?.user.id;
    showSession(session);
    if (session && (changed || event === "INITIAL_SESSION")) setTimeout(() => { void refresh(); }, 0);
    else if (!session && (changed || event === "INITIAL_SESSION")) status.textContent = "Sign in to sync PGNs between devices.";
  });

  byId("sign-in").onsubmit = async event => {
    event.preventDefault();
    const send = byId("send-link");
    send.disabled = true;
    try {
      const { error } = await client.auth.signInWithOtp({
        email: byId("email").value.trim(),
        options: { emailRedirectTo: new URL("./", location.href).href },
      });
      status.textContent = error?.message || "Open the sign-in link on this device.";
    } finally {
      send.disabled = false;
    }
  };
  byId("sign-out").onclick = async () => {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) status.textContent = error.message;
  };
  new MutationObserver(updateSaveButton).observe(pgn, { childList: true });
  byId("save-form").onsubmit = async event => {
    event.preventDefault();
    if (save.disabled) return;
    const account = userId;
    const draft = { title: title.value.trim() || "Chess game", pgn: pgn.textContent };
    if (draft.title !== pendingSave?.title || draft.pgn !== pendingSave?.pgn) {
      pendingSave = { id: crypto.randomUUID(), ...draft };
    }
    busy = true;
    updateSaveButton();
    try {
      const { error } = await client.from("saved_games").upsert(pendingSave, { onConflict: "id", ignoreDuplicates: true });
      if (account !== userId) return;
      if (error) status.textContent = error.message;
      else await refresh("Game saved.");
    } finally {
      busy = false;
      updateSaveButton();
    }
  };
}

initialize().catch(() => { status.textContent = "The game library is unavailable. PGN download is still available."; });
