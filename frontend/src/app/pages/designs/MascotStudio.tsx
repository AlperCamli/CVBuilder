import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Download,
  MessageCircle,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Route,
  Smartphone,
  Sparkles,
  Undo2,
  Upload,
} from "lucide-react";
import {
  ACTIONS,
  APPLIED_KEY,
  cloneConfig,
  DRAFT_KEY,
  MESSAGE_IDS,
  MESSAGE_LABELS,
  MESSAGE_STOP,
  parseMascotConfig,
  POSES,
  readMascotConfig,
  STOP_IDS,
  STOP_LABELS,
  STOP_MESSAGE,
  type MascotConfig,
  type MessageId,
  type RailStop,
} from "./mascot-config";
import type { StudioTelemetry } from "./useMascotSettings";
import "./designs.css";
import "./mascot-studio.css";
const BASE = "/designs/guided-journey";
const ACTION_LABELS = {
  none: "No button",
  demo: "Scroll to demo",
  templates: "Scroll to template collection",
  plans: "Scroll to pricing",
  signup: "Create free account",
  signin: "Sign in",
  trial: "Open trial details",
};
const POSE_LABELS = {
  guide: "Welcome",
  thinking: "Thinking",
  celebrate: "Delighted",
  point: "Pointing",
};
function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const id = useId(),
    focused = useRef(false);
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (!focused.current) setText(String(Math.round(value * 100) / 100));
  }, [value]);
  return (
    <div className="ms-number">
      <label htmlFor={id}>{label}</label>
      <div>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          aria-label={`${label}, exact value`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={text}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            setText(e.target.value);
            if (
              e.target.value !== "" &&
              Number.isFinite(Number(e.target.value))
            )
              onChange(Number(e.target.value));
          }}
          onBlur={() => {
            focused.current = false;
            setText(String(Math.round(value * 100) / 100));
          }}
        />
        <span>{unit}</span>
      </div>
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="ms-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export default function MascotStudio() {
  const [config, setConfig] = useState<MascotConfig>(() => {
    try {
      return localStorage.getItem(DRAFT_KEY)
        ? readMascotConfig(DRAFT_KEY)
        : readMascotConfig();
    } catch {
      return cloneConfig();
    }
  });
  const current = useRef(config),
    past = useRef<MascotConfig[]>([]),
    future = useRef<MascotConfig[]>([]),
    group = useRef({ key: "", time: 0 });
  const [stop, setStop] = useState<RailStop>("hero"),
    [tab, setTab] = useState<"position" | "dialogue" | "motion" | "mobile">(
      "position",
    );
  const [messageId, setMessageId] = useState<MessageId>("hero"),
    [pin, setPin] = useState(true),
    [inspect, setInspect] = useState(true);
  const [page, setPage] = useState("landing"),
    [viewport, setViewport] = useState("1440"),
    [zoom, setZoom] = useState("fit");
  const [ready, setReady] = useState(false),
    [saved, setSaved] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [telemetry, setTelemetry] = useState<StudioTelemetry | null>(null),
    [bounds, setBounds] = useState({ width: 1000, height: 760 });
  const frame = useRef<HTMLIFrameElement>(null),
    stage = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const options = useRef({ pin, inspect, messageId });
  options.current = { pin, inspect, messageId };
  const send = useCallback(
    (data: object) =>
      frame.current?.contentWindow?.postMessage(data, window.location.origin),
    [],
  );
  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(current.current));
      } catch {
        /* Export remains available. */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const change = useCallback(
    (update: (c: MascotConfig) => MascotConfig, key = "change") => {
      const next = parseMascotConfig(update(current.current));
      if (JSON.stringify(next) === JSON.stringify(current.current)) return;
      const now = Date.now();
      if (group.current.key !== key || now - group.current.time > 700) {
        past.current = [...past.current.slice(-79), current.current];
      }
      group.current = { key, time: now };
      future.current = [];
      current.current = next;
      setConfig(next);
      setSaved(false);
      setError("");
    },
    [],
  );
  const undo = () => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(current.current);
    current.current = previous;
    setConfig(previous);
    group.current = { key: "", time: 0 };
    setNotice("Change undone.");
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current.current);
    current.current = next;
    setConfig(next);
    group.current = { key: "", time: 0 };
    setNotice("Change restored.");
  };
  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(config));
        setSaved(true);
      } catch {
        setError(
          "Browser storage is unavailable. Export your configuration to keep it.",
        );
      }
    }, 300);
    send({ type: "mascot:config", config });
    return () => clearTimeout(timer);
  }, [config, send]);
  useEffect(() => {
    send({ type: "mascot:inspect", enabled: inspect });
  }, [inspect, send]);
  useEffect(() => {
    send({ type: "mascot:pin", id: pin ? messageId : null });
  }, [pin, messageId, send]);
  const setup = useCallback(() => {
    send({ type: "mascot:config", config: current.current });
    send({ type: "mascot:inspect", enabled: options.current.inspect });
    send({
      type: "mascot:pin",
      id: options.current.pin ? options.current.messageId : null,
    });
  }, [send]);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== location.origin
      )
        return;
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "mascot:ready") {
        setReady(true);
        setup();
      }
      if (data.type === "mascot:telemetry") setTelemetry(data.value);
      if (data.type === "mascot:notice") setNotice(data.text);
      if (
        data.type === "mascot:navigate" &&
        ["landing", "pricing"].includes(data.page)
      ) {
        setReady(false);
        setPage(data.page);
        setPin(true);
        setStop(data.page === "pricing" ? "plans" : "hero");
        setMessageId(data.page === "pricing" ? "plans" : "hero");
      }
      if (data.type === "mascot:drag-start")
        group.current = { key: "", time: 0 };
      if (
        data.type === "mascot:drag" &&
        STOP_IDS.includes(data.stop) &&
        ["mascot", "bubble"].includes(data.target) &&
        Number.isFinite(data.dx) &&
        Number.isFinite(data.dy)
      ) {
        const id = data.stop as RailStop;
        setStop(id);
        change((c) => {
          const s = c.stops[id];
          return {
            ...c,
            stops: {
              ...c.stops,
              [id]: {
                ...s,
                [data.target === "mascot" ? "x" : "bubbleX"]:
                  (data.target === "mascot" ? s.x : s.bubbleX) + data.dx,
                [data.target === "mascot" ? "y" : "bubbleY"]:
                  (data.target === "mascot" ? s.y : s.bubbleY) + data.dy,
              },
            },
          };
        }, "drag");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [change, setup]);
  useEffect(() => {
    const node = stage.current!;
    const observer = new ResizeObserver(() =>
      setBounds({
        width: node.clientWidth - 48,
        height: node.clientHeight - 48,
      }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const jump = (id: RailStop, message: MessageId = STOP_MESSAGE[id]) => {
    if (
      page === "pricing" &&
      ["hero", "demo", "showcase", "return"].includes(id)
    ) {
      setNotice("Choose the landing page preview to adjust this stop.");
      return;
    }
    setStop(id);
    setMessageId(message);
    setPin(true);
    send({
      type: "mascot:jump",
      stop: id,
      step:
        message === "keywords"
          ? 0
          : message === "templates" || message === "templateSuccess"
            ? 2
            : id === "demo"
              ? 1
              : undefined,
    });
    send({ type: "mascot:pin", id: message });
  };
  const updateStop = (
    key: keyof MascotConfig["stops"]["hero"],
    value: number | string,
  ) =>
    change(
      (c) => ({
        ...c,
        stops: { ...c.stops, [stop]: { ...c.stops[stop], [key]: value } },
      }),
      `${stop}.${key}`,
    );
  const updateMessage = (
    key: keyof MascotConfig["messages"]["hero"],
    value: string | boolean,
  ) =>
    change(
      (c) => ({
        ...c,
        messages: {
          ...c.messages,
          [messageId]: { ...c.messages[messageId], [key]: value },
        },
      }),
      `${messageId}.${key}`,
    );
  const updateMotion = (
    key: keyof MascotConfig["motion"],
    value: number | boolean,
  ) =>
    change(
      (c) => ({ ...c, motion: { ...c.motion, [key]: value } }),
      `motion.${key}`,
    );
  const updateMobile = (
    key: keyof MascotConfig["mobile"],
    value: string | number,
  ) =>
    change(
      (c) => ({ ...c, mobile: { ...c.mobile, [key]: value } }),
      `mobile.${key}`,
    );
  const exportFile = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current.current, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `companion-configuration-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "Configuration exported. You can import it here or share it with me.",
    );
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const item = event.target.files?.[0];
    event.target.value = "";
    if (!item) return;
    try {
      if (item.size > 256000)
        throw new Error(
          "This file is too large. Choose an exported Companion Studio JSON file.",
        );
      const data = parseMascotConfig(JSON.parse(await item.text()));
      change(() => data, "import");
      setNotice("Configuration imported. Undo restores your previous draft.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    }
  };
  const apply = () => {
    try {
      localStorage.setItem(APPLIED_KEY, JSON.stringify(config));
      setNotice(
        "Applied to the combined landing and pricing pages in this browser. Export the file to share these settings.",
      );
    } catch {
      setError(
        "Could not save in this browser. Export the configuration instead.",
      );
    }
  };
  const width = Number(viewport),
    height = width < 700 ? 844 : 900;
  const scale =
    zoom === "fit"
      ? Math.max(
          0.15,
          Math.min(bounds.width / width, bounds.height / height, 1),
        )
      : Number(zoom);
  const selected = config.stops[stop],
    dialogue = config.messages[messageId],
    m = config.motion;
  return (
    <div className="mascot-studio">
      <header className="ms-header">
        <div className="ms-brand">
          <Link to={BASE} aria-label="Back to the combined design">
            <ArrowLeft size={18} />
          </Link>
          <img src="/images/designs/mascot/guide.webp" alt="" />
          <div>
            <span>JOBSPECIFICCV · DESIGN TOOLS</span>
            <h1>Companion Studio</h1>
          </div>
        </div>
        <div className="ms-header-actions">
          <span className="ms-save-state">
            <span className={saved ? "is-saved" : ""} />
            {saved ? "Draft saved locally" : "Saving draft…"}
          </span>
          <button onClick={() => file.current?.click()}>
            <Upload size={15} />
            Import
          </button>
          <button onClick={exportFile}>
            <Download size={15} />
            Export JSON
          </button>
          <button className="ms-primary" onClick={apply}>
            Use on review pages <ArrowUpRight size={15} />
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            onChange={importFile}
            hidden
          />
        </div>
      </header>
      <div className="ms-workspace">
        <aside className="ms-inspector" aria-label="Companion configuration">
          <div className="ms-intro">
            <span className="ms-eyebrow">MAKE IT FEEL LIKE A CHARACTER</span>
            <h2>A little more personality.</h2>
            <p>Move, talk, react. Fine-tune every moment on the actual page.</p>
          </div>
          <div className="ms-stop-list" role="group" aria-label="Rail stops">
            {STOP_IDS.map((id, i) => (
              <button
                key={id}
                className={stop === id ? "is-active" : ""}
                onClick={() => jump(id)}
                disabled={
                  page === "pricing" &&
                  ["hero", "demo", "showcase", "return"].includes(id)
                }
                aria-pressed={stop === id}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                {STOP_LABELS[id]}
              </button>
            ))}
          </div>
          <nav className="ms-tabs" aria-label="Configuration sections">
            {(
              [
                ["position", Route, "Position"],
                ["dialogue", MessageCircle, "Dialogue"],
                ["motion", Sparkles, "Motion"],
                ["mobile", Smartphone, "Mobile"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={tab === id ? "is-active" : ""}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="ms-settings">
            {tab === "position" && (
              <>
                <div className="ms-panel-title">
                  <h3>{STOP_LABELS[stop]} position</h3>
                  <button
                    aria-label="Reset this stop"
                    title="Reset this stop"
                    onClick={() =>
                      change(
                        (c) => ({
                          ...c,
                          stops: {
                            ...c.stops,
                            [stop]: cloneConfig().stops[stop],
                          },
                        }),
                        "reset-stop",
                      )
                    }
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
                <p className="ms-help">
                  Drag the character or speech bubble in the desktop preview.
                  Values are offsets from the responsive rail.
                </p>
                {stop === "plans" && (
                  <label className="ms-field">
                    Pricing anchor
                    <select
                      value={selected.anchor ?? "outer"}
                      onChange={(e) => updateStop("anchor", e.target.value)}
                    >
                      <option value="pro-card">Beside the Pro card</option>
                      <option value="outer">Original outer rail</option>
                    </select>
                  </label>
                )}
                <Toggle
                  label="Drag handles in preview"
                  checked={inspect}
                  onChange={setInspect}
                />
                <NumberControl
                  label="Character horizontal"
                  value={selected.x}
                  min={-800}
                  max={800}
                  onChange={(v) => updateStop("x", v)}
                />
                <NumberControl
                  label="Character vertical"
                  value={selected.y}
                  min={-600}
                  max={600}
                  onChange={(v) => updateStop("y", v)}
                />
                <NumberControl
                  label="Character size"
                  value={Math.round(selected.scale * 100)}
                  min={50}
                  max={180}
                  unit="%"
                  onChange={(v) => updateStop("scale", v / 100)}
                />
                <label className="ms-field">
                  Facing direction
                  <select
                    value={selected.facing}
                    onChange={(e) => updateStop("facing", e.target.value)}
                  >
                    <option value="auto">Automatic · face inward</option>
                    <option value="left">Face left · mirrored artwork</option>
                    <option value="right">Face right · original artwork</option>
                  </select>
                </label>
                <p className="ms-help">
                  Applies to every expression at this stop. Automatic points
                  toward Start free on returning to the top. Turn off drag
                  handles to try visitor dragging; the character stays where
                  dropped until scrolling reaches another section destination.
                </p>
                <div className="ms-divider" />
                <h3>Speech bubble</h3>
                <label className="ms-field">
                  Placement
                  <select
                    value={selected.placement}
                    onChange={(e) => updateStop("placement", e.target.value)}
                  >
                    <option value="above">Above the character</option>
                    <option value="left">To the left</option>
                    <option value="right">To the right</option>
                  </select>
                </label>
                <NumberControl
                  label="Bubble horizontal"
                  value={selected.bubbleX}
                  min={-600}
                  max={600}
                  onChange={(v) => updateStop("bubbleX", v)}
                />
                <NumberControl
                  label="Bubble vertical"
                  value={selected.bubbleY}
                  min={-400}
                  max={400}
                  onChange={(v) => updateStop("bubbleY", v)}
                />
                <Toggle
                  label="Fit bubble to available space"
                  checked={selected.bubbleWidth === 0}
                  onChange={(v) => updateStop("bubbleWidth", v ? 0 : 220)}
                />
                {selected.bubbleWidth !== 0 && (
                  <NumberControl
                    label="Bubble width"
                    value={selected.bubbleWidth}
                    min={160}
                    max={420}
                    onChange={(v) => updateStop("bubbleWidth", v)}
                  />
                )}
              </>
            )}
            {tab === "dialogue" && (
              <>
                <h3>What happens in this moment?</h3>
                <label className="ms-field">
                  Message or reaction
                  <select
                    value={messageId}
                    onChange={(e) => {
                      const id = e.target.value as MessageId;
                      jump(MESSAGE_STOP[id], id);
                    }}
                  >
                    {MESSAGE_IDS.map((id) => (
                      <option key={id} value={id}>
                        {MESSAGE_LABELS[id]}
                      </option>
                    ))}
                  </select>
                </label>
                <Toggle
                  label="Hold this message in preview"
                  checked={pin}
                  onChange={setPin}
                />
                <p className="ms-help">
                  Switch this off to hear the companion respond to scrolling and
                  demo actions.
                </p>
                <Toggle
                  label="Show this bubble"
                  checked={dialogue.enabled}
                  onChange={(v) => updateMessage("enabled", v)}
                />
                <label className="ms-field">
                  Dialogue
                  <textarea
                    rows={3}
                    value={dialogue.text}
                    maxLength={240}
                    onChange={(e) => updateMessage("text", e.target.value)}
                  />
                  <small>
                    {dialogue.text.length}/240 · One short sentence feels
                    natural.
                  </small>
                </label>
                <label className="ms-field">Expression</label>
                <div className="ms-poses">
                  {POSES.map((pose) => (
                    <button
                      key={pose}
                      onClick={() => updateMessage("pose", pose)}
                      aria-pressed={dialogue.pose === pose}
                      className={dialogue.pose === pose ? "is-active" : ""}
                    >
                      <img src={`/images/designs/mascot/${pose}.webp`} alt="" />
                      {POSE_LABELS[pose]}
                    </button>
                  ))}
                </div>
                <div className="ms-divider" />
                <h3>Bubble actions</h3>
                <label className="ms-field">
                  Primary action
                  <select
                    value={dialogue.action}
                    onChange={(e) => updateMessage("action", e.target.value)}
                  >
                    {ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </label>
                {dialogue.action !== "none" && (
                  <label className="ms-field">
                    Button text
                    <input
                      value={dialogue.label}
                      maxLength={45}
                      onChange={(e) => updateMessage("label", e.target.value)}
                    />
                  </label>
                )}
                <label className="ms-field">
                  Secondary link
                  <select
                    value={dialogue.secondaryAction}
                    onChange={(e) =>
                      updateMessage("secondaryAction", e.target.value)
                    }
                  >
                    {ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </label>
                {dialogue.secondaryAction !== "none" && (
                  <label className="ms-field">
                    Link text
                    <input
                      value={dialogue.secondaryLabel}
                      maxLength={55}
                      onChange={(e) =>
                        updateMessage("secondaryLabel", e.target.value)
                      }
                    />
                  </label>
                )}
                <button
                  className="ms-text-button"
                  onClick={() =>
                    change(
                      (c) => ({
                        ...c,
                        messages: {
                          ...c.messages,
                          [messageId]: cloneConfig().messages[messageId],
                        },
                      }),
                      "reset-message",
                    )
                  }
                >
                  <RotateCcw size={13} />
                  Reset this message
                </button>
              </>
            )}
            {tab === "motion" && (
              <>
                <h3>Give your companion a rhythm.</h3>
                <p className="ms-help">
                  Turn off drag handles to feel the following motion.
                  Reduced-motion preferences always take priority.
                </p>
                <div className="ms-presets">
                  {["Quiet", "Friendly", "Lively"].map((label, i) => (
                    <button
                      key={label}
                      onClick={() =>
                        change(
                          (c) => ({
                            ...c,
                            motion: {
                              ...c.motion,
                              bob: [0, 2, 4][i],
                              smoothing: [80, 140, 240][i],
                              lean: [0, 1.5, 3][i],
                            },
                          }),
                          `preset-${label}`,
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <NumberControl
                  label="Follow softness"
                  value={m.smoothing}
                  min={0}
                  max={600}
                  step={10}
                  unit="ms"
                  onChange={(v) => updateMotion("smoothing", v)}
                />
                <NumberControl
                  label="Idle bob"
                  value={m.bob}
                  min={0}
                  max={8}
                  step={0.5}
                  onChange={(v) => updateMotion("bob", v)}
                />
                <NumberControl
                  label="Idle cycle"
                  value={m.idleSeconds}
                  min={2}
                  max={12}
                  step={0.5}
                  unit="s"
                  onChange={(v) => updateMotion("idleSeconds", v)}
                />
                <NumberControl
                  label="Movement lean"
                  value={m.lean}
                  min={0}
                  max={8}
                  step={0.5}
                  unit="°"
                  onChange={(v) => updateMotion("lean", v)}
                />
                <div className="ms-divider" />
                <h3>Reactions</h3>
                <NumberControl
                  label="Reaction duration"
                  value={m.reactionMs}
                  min={500}
                  max={6000}
                  step={100}
                  unit="ms"
                  onChange={(v) => updateMotion("reactionMs", v)}
                />
                <NumberControl
                  label="Pause after typing"
                  value={m.editDelay}
                  min={200}
                  max={2000}
                  step={100}
                  unit="ms"
                  onChange={(v) => updateMotion("editDelay", v)}
                />
                <Toggle
                  label="React again to repeated actions"
                  checked={m.repeatReactions}
                  onChange={(v) => updateMotion("repeatReactions", v)}
                />
                {m.repeatReactions && (
                  <NumberControl
                    label="Time between reactions"
                    value={m.cooldownMs / 1000}
                    min={1}
                    max={30}
                    unit="s"
                    onChange={(v) => updateMotion("cooldownMs", v * 1000)}
                  />
                )}
                <div className="ms-divider" />
                <h3>When to travel</h3>
                <p className="ms-help">
                  Positive values start a transition earlier; negative values
                  wait longer.
                </p>
                <NumberControl
                  label="Approach demo earlier"
                  value={m.demoEarly}
                  min={-400}
                  max={400}
                  step={10}
                  onChange={(v) => updateMotion("demoEarly", v)}
                />
                <NumberControl
                  label="Approach template collection earlier"
                  value={m.showcaseEarly}
                  min={-400}
                  max={400}
                  step={10}
                  onChange={(v) => updateMotion("showcaseEarly", v)}
                />
                <NumberControl
                  label="Move to pricing earlier"
                  value={m.pricingEarly}
                  min={-400}
                  max={400}
                  step={10}
                  onChange={(v) => updateMotion("pricingEarly", v)}
                />
                <NumberControl
                  label="Reach closing earlier"
                  value={m.closingEarly}
                  min={-400}
                  max={400}
                  step={10}
                  onChange={(v) => updateMotion("closingEarly", v)}
                />
                <NumberControl
                  label="Return-to-top distance"
                  value={m.returnDistance}
                  min={120}
                  max={600}
                  step={20}
                  onChange={(v) => updateMotion("returnDistance", v)}
                />
                <Toggle
                  label="Tuck bubble away while crossing"
                  checked={m.hideWhileTraveling}
                  onChange={(v) => updateMotion("hideWhileTraveling", v)}
                />
              </>
            )}
            {tab === "mobile" && (
              <>
                <h3>A small-screen companion.</h3>
                <p className="ms-help">
                  Below 1360px wide or 560px high, the character floats in a
                  corner. The bubble opens on tap and closes while typing or in
                  a dialog.
                </p>
                <button
                  className="ms-text-button"
                  onClick={() => setViewport("390")}
                >
                  <Smartphone size={14} />
                  Switch preview to phone
                </button>
                <label className="ms-field">
                  Corner
                  <select
                    value={config.mobile.side}
                    onChange={(e) => updateMobile("side", e.target.value)}
                  >
                    <option value="right">Bottom right</option>
                    <option value="left">Bottom left</option>
                  </select>
                </label>
                <NumberControl
                  label="Bottom spacing"
                  value={config.mobile.bottom}
                  min={8}
                  max={140}
                  onChange={(v) => updateMobile("bottom", v)}
                />
                <NumberControl
                  label="Compact size"
                  value={config.mobile.size}
                  min={36}
                  max={90}
                  onChange={(v) => updateMobile("size", v)}
                />
                <NumberControl
                  label="Compact bubble width"
                  value={config.mobile.bubbleWidth}
                  min={180}
                  max={320}
                  onChange={(v) => updateMobile("bubbleWidth", v)}
                />
              </>
            )}
          </div>
          <footer className="ms-inspector-footer">
            <span>Changes stay in this browser.</span>
            <button
              onClick={() => {
                change(() => cloneConfig(), "reset-all");
                setNotice(
                  "Draft reset to the original settings. Undo restores your work.",
                );
              }}
            >
              <RotateCcw size={13} />
              Reset draft
            </button>
          </footer>
        </aside>
        <main className="ms-preview">
          <div className="ms-preview-toolbar">
            <div>
              <span className="ms-live-dot" />
              LIVE PREVIEW
            </div>
            <label className="ms-sr-only" htmlFor="ms-page">
              Preview page
            </label>
            <select
              id="ms-page"
              value={page}
              onChange={(e) => {
                const next = e.target.value;
                setReady(false);
                setPage(next);
                setStop(next === "pricing" ? "plans" : "hero");
                setMessageId(next === "pricing" ? "plans" : "hero");
                setPin(true);
              }}
            >
              <option value="landing">Landing page</option>
              <option value="pricing">Pricing page</option>
            </select>
            <label className="ms-sr-only" htmlFor="ms-viewport">
              Preview viewport
            </label>
            <select
              id="ms-viewport"
              value={viewport}
              onChange={(e) => setViewport(e.target.value)}
            >
              <option value="1440">Desktop · 1440</option>
              <option value="1360">Desktop · 1360</option>
              <option value="768">Tablet · 768</option>
              <option value="390">Phone · 390</option>
              <option value="320">Phone · 320</option>
            </select>
            <label className="ms-sr-only" htmlFor="ms-zoom">
              Preview zoom
            </label>
            <select
              id="ms-zoom"
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
            >
              <option value="fit">Fit · {Math.round(scale * 100)}%</option>
              <option value="1">100%</option>
              <option value="0.75">75%</option>
              <option value="0.5">50%</option>
            </select>
            <div className="ms-history">
              <button
                aria-label="Undo configuration change"
                disabled={!past.current.length}
                onClick={undo}
              >
                <Undo2 size={16} />
              </button>
              <button
                aria-label="Redo configuration change"
                disabled={!future.current.length}
                onClick={redo}
              >
                <Redo2 size={16} />
              </button>
            </div>
            <a
              href={`${BASE}${page === "pricing" ? "/pricing" : ""}`}
              target="_blank"
              rel="noreferrer"
              title="Open review page with applied settings"
              aria-label="Open review page"
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
          <div className="ms-canvas" ref={stage}>
            <div
              className="ms-frame"
              style={{ width: width * scale, height: height * scale }}
            >
              <iframe
                ref={frame}
                title="Live companion design preview"
                src={`${BASE}${page === "pricing" ? "/pricing" : ""}?mascotStudio=1`}
                width={width}
                height={height}
                style={{ transform: `scale(${scale})` }}
                onLoad={setup}
              />
              {!ready && (
                <div className="ms-loading">Opening your workspace…</div>
              )}
            </div>
          </div>
          <div className="ms-timeline">
            <div className="ms-timeline-top">
              <div>
                <span className="ms-eyebrow">SCROLL THROUGH THE STORY</span>
                <strong>
                  {telemetry ? STOP_LABELS[telemetry.context] : "Welcome"}
                  <small>
                    {telemetry?.mode === "compact"
                      ? "Compact companion"
                      : `X ${telemetry?.x ?? 0} · Y ${telemetry?.y ?? 0}`}
                  </small>
                </strong>
              </div>
              <div className="ms-playback">
                <button
                  onClick={() => {
                    setPin(false);
                    setInspect(false);
                    send({ type: "mascot:play", reverse: true });
                  }}
                  disabled={!ready || telemetry?.reduced}
                  title="Play upward"
                >
                  <RotateCcw size={15} />
                </button>
                <button
                  className="ms-play"
                  disabled={!ready || telemetry?.reduced}
                  onClick={() => {
                    if (telemetry?.playing) send({ type: "mascot:pause" });
                    else {
                      setPin(false);
                      setInspect(false);
                      send({ type: "mascot:play" });
                    }
                  }}
                >
                  {telemetry?.playing ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} />
                  )}{" "}
                  {telemetry?.playing ? "Pause" : "Play scroll"}
                </button>
              </div>
            </div>
            <input
              type="range"
              aria-label="Page scroll position"
              min="0"
              max="1000"
              value={Math.round((telemetry?.progress ?? 0) * 1000)}
              onChange={(e) => {
                setPin(false);
                send({
                  type: "mascot:scroll",
                  progress: Number(e.target.value) / 1000,
                });
              }}
            />
            <div className="ms-timeline-labels">
              <span>Top of page</span>
              <span>{Math.round((telemetry?.progress ?? 0) * 100)}%</span>
              <span>End of page</span>
            </div>
            <div className="ms-preview-hint">
              <MousePointer2 size={13} />
              {telemetry?.reduced
                ? "Reduced motion is enabled on this device."
                : inspect
                  ? "Drag the character or bubble. Buttons and the demo still work."
                  : "Scroll in the preview or play the route to feel the movement."}
            </div>
          </div>
        </main>
      </div>
      <div className={`ms-status ${error ? "is-error" : ""}`} role="status">
        <span>
          {error ||
            notice ||
            (telemetry?.overlap
              ? "The companion overlaps a card or workspace here. Adjust the position or bubble offset."
              : "Your draft is separate from the review pages until you choose “Use on review pages”.")}
        </span>
        <div>
          {notice || error ? (
            <button
              aria-label="Dismiss status"
              onClick={() => {
                setNotice("");
                setError("");
              }}
            >
              Dismiss
            </button>
          ) : (
            <Check size={14} />
          )}
          <button
            onClick={() => {
              try {
                localStorage.removeItem(APPLIED_KEY);
                setNotice(
                  "Review pages now use the original settings. Your studio draft is retained.",
                );
              } catch {
                setError("Could not access browser storage.");
              }
            }}
          >
            Restore review defaults
          </button>
        </div>
      </div>
    </div>
  );
}
