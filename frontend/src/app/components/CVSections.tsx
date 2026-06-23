import {
  GripVertical,
  Eye,
  EyeOff,
  Trash2,
  Plus,
  Sparkles,
  Linkedin,
  Github,
  Globe,
  X as XIcon,
  Upload,
  Camera,
  Circle,
  Square,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { useDrag, useDrop } from "react-dnd";
import { DateInputHelper } from "./DateInputHelper";
import { BulletTextarea } from "./BulletTextarea";
import { useAuth } from "../integration/auth-context";
import { supabase } from "../integration/supabase-client";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/png", "image/jpeg"];

// A stored photo value is a managed files.id when it is neither a legacy inline data URI nor
// an absolute URL; those need to be resolved to a signed URL before display.
const isDisplayablePhoto = (value: unknown): value is string =>
  typeof value === "string" && (value.startsWith("data:") || /^https?:\/\//i.test(value));

const isManagedPhotoReference = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && !isDisplayablePhoto(value);

interface HeaderSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onChange: (data: any) => void;
}

export function HeaderSection({ data, isHidden, onToggleVisibility, onChange }: HeaderSectionProps) {
  const { api } = useAuth();
  const [showSocialModal, setShowSocialModal] = useState(false);
  const [newSocialType, setNewSocialType] = useState("");
  const [newSocialUrl, setNewSocialUrl] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const socialLinks = data.socialLinks || [];
  const photoShape = data.photoShape === "square" ? "square" : "circle";
  const photoPosition =
    data.photoPosition === "center" || data.photoPosition === "right" ? data.photoPosition : "left";

  // Resolve the stored photo (a managed files.id) to a signed URL for the thumbnail.
  // Legacy inline data URIs (and absolute URLs) are already displayable.
  useEffect(() => {
    const photo = data.photo as string | null | undefined;
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    if (isDisplayablePhoto(photo)) {
      setPhotoUrl(photo);
      return;
    }

    let cancelled = false;
    api
      .getCvPhotoUrl(photo)
      .then((res) => {
        if (!cancelled) {
          setPhotoUrl(res.signed_url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPhotoUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.photo]);

  const socialPlatforms = [
    { type: "linkedin", label: "LinkedIn", icon: Linkedin },
    { type: "github", label: "GitHub", icon: Github },
    { type: "portfolio", label: "Portfolio", icon: Globe },
    { type: "behance", label: "Behance", icon: Globe },
    { type: "dribbble", label: "Dribbble", icon: Globe },
    { type: "website", label: "Website", icon: Globe },
  ];

  const addSocialLink = () => {
    if (newSocialType && newSocialUrl) {
      onChange({
        ...data,
        socialLinks: [...socialLinks, { type: newSocialType, url: newSocialUrl, id: String(Date.now()) }],
      });
      setNewSocialType("");
      setNewSocialUrl("");
      setShowSocialModal(false);
    }
  };

  const updateSocialLink = (id: string | number, patch: Record<string, unknown>) => {
    onChange({
      ...data,
      socialLinks: socialLinks.map((link: any) =>
        String(link.id) === String(id) ? { ...link, ...patch } : link
      )
    });
  };

  const removeSocialLink = (id: string | number) => {
    onChange({
      ...data,
      socialLinks: socialLinks.filter((link: any) => String(link.id) !== String(id)),
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again re-triggers onChange.
    e.target.value = "";
    if (!file) {
      return;
    }

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Please choose a PNG or JPEG image.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError("Image must be 5 MB or smaller.");
      return;
    }

    setPhotoError(null);
    setPhotoUploading(true);
    const previousPhoto = typeof data.photo === "string" ? data.photo : null;
    try {
      // 1) Ask the backend for a signed direct-to-storage upload target.
      const target = await api.createCvPhotoUploadUrl({
        content_type: file.type,
        size_bytes: file.size
      });
      // 2) Upload the bytes straight to storage (avoids large bodies through the API).
      const { error: uploadError } = await supabase.storage
        .from(target.storage_bucket)
        .uploadToSignedUrl(target.storage_path, target.token, file);
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      // 3) Finalize: backend validates the object and persists its files row.
      const finalized = await api.completeCvPhotoUpload(target.file_id, {
        storage_path: target.storage_path
      });

      onChange({ ...data, photo: finalized.file_id });
      setPhotoUrl(finalized.signed_url);

      // Clean up a previously managed photo that this upload replaces.
      if (previousPhoto && isManagedPhotoReference(previousPhoto)) {
        api.deleteCvPhoto(previousPhoto).catch(() => {});
      }
    } catch {
      setPhotoError("Photo upload failed. Please try again.");
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = () => {
    const previousPhoto = typeof data.photo === "string" ? data.photo : null;
    onChange({ ...data, photo: null });
    setPhotoUrl(null);
    setPhotoError(null);
    if (previousPhoto && isManagedPhotoReference(previousPhoto)) {
      api.deleteCvPhoto(previousPhoto).catch(() => {});
    }
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical 
            size={14} 
            style={{ color: "var(--color-text-secondary)", cursor: "not-allowed", opacity: 0.3 }} 
          />
          Header
        </h3>
        <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
          {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {!isHidden && (
        <div className="space-y-3">
          {/* Photo Upload */}
          <div className="p-3 rounded-lg border" style={{ borderColor: "var(--color-border-tertiary)" }}>
            <div className="flex items-center gap-3">
              {photoUrl ? (
                <div className="relative">
                  <img
                    src={photoUrl}
                    alt="Profile"
                    className="w-16 h-16 object-cover"
                    style={{ borderRadius: photoShape === "square" ? "8px" : "999px" }}
                  />
                  <button
                    onClick={handleRemovePhoto}
                    className="absolute -top-1 -right-1 p-0.5 rounded-full"
                    style={{ fontSize: "10px", background: "var(--color-danger)", color: "var(--color-danger-bg)" }}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ) : (
                <label
                  className={`w-16 h-16 border-2 border-dashed flex items-center justify-center transition-colors ${
                    photoUploading ? "opacity-60 cursor-wait" : "cursor-pointer hover:bg-[var(--color-background-secondary)]"
                  }`}
                  style={{
                    borderColor: "var(--color-border-tertiary)",
                    borderRadius: photoShape === "square" ? "8px" : "999px"
                  }}
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handlePhotoUpload}
                    disabled={photoUploading}
                    className="hidden"
                  />
                  <Camera size={20} style={{ color: "var(--color-text-secondary)" }} />
                </label>
              )}
              <div className="flex-1">
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                  Profile Photo
                </p>
                <p style={{ fontSize: "12px", color: photoError ? "var(--color-danger)" : "var(--color-text-secondary)" }}>
                  {photoError
                    ? photoError
                    : photoUploading
                      ? "Uploading…"
                      : photoUrl
                        ? "Click X to remove"
                        : "PNG or JPEG, up to 5 MB"}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div>
                <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                  Position
                </p>
                <div className="flex items-center gap-1">
                  {([
                    { position: "left", Icon: AlignLeft, label: "Left" },
                    { position: "center", Icon: AlignCenter, label: "Middle top" },
                    { position: "right", Icon: AlignRight, label: "Right" }
                  ] as const).map(({ position, Icon, label }) => {
                    const selected = photoPosition === position;
                    return (
                      <button
                        key={position}
                        type="button"
                        title={label}
                        aria-label={`${label} photo position`}
                        aria-pressed={selected}
                        onClick={() => onChange({ ...data, photoPosition: position })}
                        className="p-1.5 rounded-lg border transition-colors"
                        style={{
                          borderColor: selected ? "var(--color-teal-600)" : "var(--color-border-secondary)",
                          background: selected ? "var(--color-teal-50)" : "transparent",
                          color: selected ? "var(--color-teal-800)" : "var(--color-text-secondary)"
                        }}
                      >
                        <Icon size={16} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                  Frame
                </p>
                <div className="flex items-center gap-1">
                  {([
                    { shape: "circle", Icon: Circle, label: "Circle" },
                    { shape: "square", Icon: Square, label: "Square" }
                  ] as const).map(({ shape, Icon, label }) => {
                    const selected = photoShape === shape;
                    return (
                      <button
                        key={shape}
                        type="button"
                        title={label}
                        aria-label={`${label} photo`}
                        aria-pressed={selected}
                        onClick={() => onChange({ ...data, photoShape: shape })}
                        className="p-1.5 rounded-lg border transition-colors"
                        style={{
                          borderColor: selected ? "var(--color-teal-600)" : "var(--color-border-secondary)",
                          background: selected ? "var(--color-teal-50)" : "transparent",
                          color: selected ? "var(--color-teal-800)" : "var(--color-text-secondary)"
                        }}
                      >
                        <Icon size={16} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <input
            type="text"
            placeholder="Full name"
            value={data.name || ""}
            onChange={(e) => onChange({ ...data, name: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
              background: "var(--color-background-primary)",
            }}
          />
          <input
            type="text"
            placeholder="Job title"
            value={data.title || ""}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
              background: "var(--color-background-primary)",
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="email"
              placeholder="Email"
              value={data.email || ""}
              onChange={(e) => onChange({ ...data, email: e.target.value })}
              className="px-3 py-2 rounded-lg border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
                background: "var(--color-background-primary)",
              }}
            />
            <input
              type="tel"
              placeholder="Phone"
              value={data.phone || ""}
              onChange={(e) => onChange({ ...data, phone: e.target.value })}
              className="px-3 py-2 rounded-lg border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
                background: "var(--color-background-primary)",
              }}
            />
          </div>
          <input
            type="text"
            placeholder="Location (optional)"
            value={data.location || ""}
            onChange={(e) => onChange({ ...data, location: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
              background: "var(--color-background-primary)",
            }}
          />

          {/* Portfolio Links */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                Portfolio Links
              </label>
              <button
                onClick={() => setShowSocialModal(true)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-background-secondary)] transition-colors"
                style={{ color: "var(--color-teal-600)" }}
              >
                <Plus size={16} />
              </button>
            </div>

            {socialLinks.length > 0 && (
              <div className="space-y-2">
                {socialLinks.map((link: any) => {
                  const platform = socialPlatforms.find(p => p.type === link.type);
                  const Icon = platform?.icon || Globe;
                  return (
                    <div
                      key={link.id}
                      className="p-2 rounded-lg border space-y-2"
                      style={{ borderColor: "var(--color-border-tertiary)" }}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={14} style={{ color: "var(--color-text-secondary)" }} />
                        <select
                          value={link.type || "website"}
                          onChange={(event) => updateSocialLink(link.id, { type: event.target.value })}
                          className="px-2 py-1 rounded border"
                          style={{
                            fontSize: "12px",
                            borderColor: "var(--color-border-secondary)",
                            background: "var(--color-background-primary)",
                            color: "var(--color-text-primary)",
                            flex: 1
                          }}
                        >
                          {socialPlatforms.map((item) => (
                            <option key={item.type} value={item.type}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeSocialLink(link.id)}
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <input
                        type="url"
                        placeholder="https://example.com"
                        value={link.url || ""}
                        onChange={(event) => updateSocialLink(link.id, { url: event.target.value })}
                        className="w-full px-2 py-1.5 rounded border"
                        style={{
                          fontSize: "12px",
                          borderColor: "var(--color-border-secondary)",
                          background: "var(--color-background-primary)",
                          color: "var(--color-text-primary)"
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Social Link Modal */}
          {showSocialModal && (
            <div className="fixed inset-0 bg-black/20 flex items-center justify-center p-4 z-50" onClick={() => setShowSocialModal(false)}>
              <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-lg" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-medium mb-4" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  Add Portfolio Link
                </h3>
                <div className="space-y-3">
                  <select
                    value={newSocialType}
                    onChange={(e) => setNewSocialType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)",
                    }}
                  >
                    <option value="">Select platform</option>
                    {socialPlatforms.map((platform) => (
                      <option key={platform.type} value={platform.type}>
                        {platform.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="url"
                    placeholder="URL"
                    value={newSocialUrl}
                    onChange={(e) => setNewSocialUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border"
                    style={{
                      fontSize: "13px",
                      borderColor: "var(--color-border-secondary)",
                      background: "var(--color-background-primary)",
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={addSocialLink}
                      disabled={!newSocialType || !newSocialUrl}
                      className="flex-1 px-4 py-2 rounded-lg font-medium"
                      style={{
                        fontSize: "13px",
                        background: newSocialType && newSocialUrl ? "var(--color-teal-600)" : "var(--color-slate-200)",
                        color: newSocialType && newSocialUrl ? "white" : "var(--color-text-secondary)",
                        cursor: newSocialType && newSocialUrl ? "pointer" : "not-allowed",
                      }}
                    >
                      Add Link
                    </button>
                    <button
                      onClick={() => {
                        setShowSocialModal(false);
                        setNewSocialType("");
                        setNewSocialUrl("");
                      }}
                      className="px-4 py-2 rounded-lg border"
                      style={{
                        fontSize: "13px",
                        borderColor: "var(--color-border-tertiary)",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SummarySectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
  onAIAssist: (blockId?: string) => void;
  aiVersionNavigator?: AiVersionNavigatorState;
}

export interface AiVersionNavigatorState {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function AIVersionNavigator({ state }: { state: AiVersionNavigatorState | undefined }) {
  if (!state || state.total <= 1) {
    return null;
  }

  const canPrev = state.current > 0;
  const canNext = state.current < state.total - 1;

  return (
    <div
      className="px-1.5 py-1 rounded-lg border flex items-center gap-1"
      style={{
        borderColor: "var(--color-border-secondary)",
        color: "var(--color-text-secondary)",
        fontSize: "11px"
      }}
    >
      <button
        onClick={state.onPrev}
        disabled={!canPrev}
        className="p-0.5 rounded"
        style={{ opacity: canPrev ? 1 : 0.35 }}
        aria-label="Previous AI version"
      >
        <ChevronLeft size={12} />
      </button>
      <span>{state.current + 1} / {state.total}</span>
      <button
        onClick={state.onNext}
        disabled={!canNext}
        className="p-0.5 rounded"
        style={{ opacity: canNext ? 1 : 0.35 }}
        aria-label="Next AI version"
      >
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

export function SummarySection({
  data,
  isHidden,
  onToggleVisibility,
  onRemove,
  onChange,
  onAIAssist,
  aiVersionNavigator
}: SummarySectionProps) {
  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Professional Summary
        </h3>
        <div className="flex items-center gap-2">
          <AIVersionNavigator state={aiVersionNavigator} />
          <button
            onClick={() => onAIAssist(data?.blockId)}
            className="px-3 py-1 rounded-lg flex items-center gap-1.5"
            style={{
              fontSize: "12px",
              background: "var(--color-teal-50)",
              color: "var(--color-teal-800)",
            }}
          >
            <Sparkles size={12} />
            Improve with AI
          </button>
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {!isHidden && (
        <textarea
          rows={4}
          placeholder="Write your professional summary..."
          value={data.text || ""}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border resize-none"
          style={{
            fontSize: "13px",
            lineHeight: "1.6",
            borderColor: "var(--color-border-secondary)",
            background: "var(--color-background-primary)",
          }}
        />
      )}
    </div>
  );
}

interface ExperienceItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
  onAIAssist: (blockId?: string) => void;
  aiVersionNavigator?: AiVersionNavigatorState;
}

function ExperienceItem({
  item,
  index,
  updateItem,
  removeItem,
  toggleItemVisibility,
  toggleItemCollapsed,
  moveItem,
  onAIAssist,
  aiVersionNavigator
}: ExperienceItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "EXPERIENCE_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "EXPERIENCE_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
  });

  drag(drop(ref));

  const isCollapsed = item.collapsed;

  return (
    <div
      ref={ref}
      className="p-3 rounded-lg border space-y-2"
      style={{
        borderColor: "var(--color-border-tertiary)",
        opacity: item.hidden ? 0.5 : isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div style={{ cursor: "grab", color: "var(--color-text-secondary)" }}>
            <GripVertical size={14} />
          </div>
          <button
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-[var(--color-background-secondary)] rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.role || "Untitled Position"} {item.company && `at ${item.company}`}
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {item.startDate || "Start Date"} - {item.currentRole ? "Present" : (item.endDate || "End Date")}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Company"
              value={item.company}
              onChange={(e) => updateItem(index, { ...item, company: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
            <input
              type="text"
              placeholder="Role"
              value={item.role}
              onChange={(e) => updateItem(index, { ...item, role: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
          </div>
          <input
            type="text"
            placeholder="Country"
            value={item.country || ""}
            onChange={(e) => updateItem(index, { ...item, country: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <DateInputHelper
              value={item.startDate || ""}
              placeholder="Start Date (e.g. Jan 2020)"
              onChange={(nextValue) => updateItem(index, { ...item, startDate: nextValue })}
            />
            <DateInputHelper
              value={item.endDate || ""}
              placeholder="End Date (e.g. Dec 2023)"
              disabled={item.currentRole}
              onChange={(nextValue) => updateItem(index, { ...item, endDate: nextValue })}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={item.currentRole || false}
              onChange={(e) =>
                updateItem(index, {
                  ...item,
                  currentRole: e.target.checked,
                  endDate: e.target.checked
                    ? "Present"
                    : item.endDate === "Present"
                      ? ""
                      : item.endDate
                })
              }
              className="w-4 h-4 rounded"
              style={{
                accentColor: "var(--color-teal-600)",
              }}
            />
            <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              I currently work here
            </span>
          </label>
          <BulletTextarea
            rows={3}
            placeholder="Responsibilities, Achievements, Technologies/Tools…"
            value={item.description || ""}
            onValueChange={(next) => updateItem(index, { ...item, description: next })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => onAIAssist(item.blockId ?? String(item.id ?? ""))}
              className="px-3 py-1 rounded-lg flex items-center gap-1.5"
              style={{
                fontSize: "12px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
              }}
            >
              <Sparkles size={12} />
              Improve with AI
            </button>
            <AIVersionNavigator state={aiVersionNavigator} />
          </div>
        </div>
      )}
    </div>
  );
}

interface ExperienceSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
  onAIAssist: (blockId?: string) => void;
  getAiVersionNavigator?: (blockId?: string) => AiVersionNavigatorState | undefined;
}

export function ExperienceSection({
  data,
  isHidden,
  onToggleVisibility,
  onRemove,
  onChange,
  onAIAssist,
  getAiVersionNavigator
}: ExperienceSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), company: "", role: "", country: "", startDate: "", endDate: "", currentRole: false, description: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Work Experience
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <ExperienceItem
              key={item.id || `exp-item-${index}`}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
              onAIAssist={onAIAssist}
              aiVersionNavigator={getAiVersionNavigator?.(item.blockId)}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add position</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface EducationSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
  onAIAssist?: (blockId?: string) => void;
  aiVersionNavigator?: AiVersionNavigatorState;
}

interface EducationItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
}

const DEGREE_SUGGESTIONS = [
  "Associate",
  "Bachelor",
  "Master",
  "PhD",
  "MBA",
  "Diploma",
  "Certificate",
  "High School"
] as const;

function EducationItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem }: EducationItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "EDUCATION_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "EDUCATION_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
  });

  drag(drop(ref));

  const isCollapsed = item.collapsed;
  const degreeDatalistId = `education-degree-suggestions-${index}`;

  return (
    <div
      ref={ref}
      className="p-3 rounded-lg border space-y-2"
      style={{
        borderColor: "var(--color-border-tertiary)",
        opacity: item.hidden ? 0.5 : isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div style={{ cursor: "grab", color: "var(--color-text-secondary)" }}>
            <GripVertical size={14} />
          </div>
          <button
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-[var(--color-background-secondary)] rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.degree || "Degree"} {item.fieldOfStudy && `in ${item.fieldOfStudy}`}
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {item.institution || "Institution"} • {item.startDate || "Start"} - {item.expectedGraduation ? "Expected" : (item.endDate || "End")}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <input
            type="text"
            placeholder="Institution"
            value={item.institution}
            onChange={(e) => updateItem(index, { ...item, institution: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <input
                type="text"
                list={degreeDatalistId}
                placeholder="Degree"
                value={item.degree || ""}
                onChange={(e) => updateItem(index, { ...item, degree: e.target.value })}
                className="w-full px-2 py-1.5 rounded border"
                style={{
                  fontSize: "13px",
                  borderColor: "var(--color-border-secondary)",
                }}
              />
              <datalist id={degreeDatalistId}>
                {DEGREE_SUGGESTIONS.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>
            <input
              type="text"
              placeholder="Field of Study / Major *"
              value={item.fieldOfStudy || ""}
              onChange={(e) => updateItem(index, { ...item, fieldOfStudy: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
          </div>
          <input
            type="text"
            placeholder="GPA *"
            value={item.gpa || ""}
            onChange={(e) => updateItem(index, { ...item, gpa: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <DateInputHelper
              value={item.startDate || ""}
              placeholder="Start Date (e.g. 2015)"
              onChange={(nextValue) => updateItem(index, { ...item, startDate: nextValue })}
            />
            <DateInputHelper
              value={item.endDate || ""}
              placeholder={item.expectedGraduation ? "Expected Graduation" : "End Date (e.g. 2019)"}
              onChange={(nextValue) => updateItem(index, { ...item, endDate: nextValue })}
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.expectedGraduation || false}
                onChange={(e) => updateItem(index, { ...item, expectedGraduation: e.target.checked })}
                className="w-4 h-4 rounded"
                style={{
                  accentColor: "var(--color-teal-600)",
                }}
              />
              <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Expected Graduation
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={item.exchangeProgram || false}
                onChange={(e) => updateItem(index, { ...item, exchangeProgram: e.target.checked })}
                className="w-4 h-4 rounded"
                style={{
                  accentColor: "var(--color-teal-600)",
                }}
              />
              <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Exchange Program
              </span>
            </label>
          </div>
          <BulletTextarea
            rows={2}
            placeholder="Additional details (optional)"
            value={item.description || ""}
            onValueChange={(next) => updateItem(index, { ...item, description: next })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function EducationSection({
  data,
  isHidden,
  onToggleVisibility,
  onRemove,
  onChange,
  onAIAssist,
  aiVersionNavigator
}: EducationSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), institution: "", degree: "", fieldOfStudy: "", gpa: "", startDate: "", endDate: "", expectedGraduation: false, exchangeProgram: false, description: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Education
        </h3>
        <div className="flex items-center gap-2">
          <AIVersionNavigator state={aiVersionNavigator} />
          {onAIAssist && (
            <button
              onClick={() => onAIAssist((data.items || [])[0]?.blockId)}
              className="px-3 py-1 rounded-lg flex items-center gap-1.5"
              style={{
                fontSize: "12px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
              }}
            >
              <Sparkles size={12} />
              Improve with AI
            </button>
          )}
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <EducationItem
              key={item.id || `edu-item-${index}`}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add education</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface SkillsSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
  onAIAssist?: (blockId?: string) => void;
  aiVersionNavigator?: AiVersionNavigatorState;
  suggestionPoolPanel?: ReactNode;
}

export function SkillsSection({
  data,
  isHidden,
  onToggleVisibility,
  onRemove,
  onChange,
  onAIAssist,
  aiVersionNavigator,
  suggestionPoolPanel
}: SkillsSectionProps) {
  const skills = data.skills || [];

  const addSkill = (skill: string) => {
    if (skill.trim()) {
      onChange({ ...data, skills: [...skills, skill.trim()] });
    }
  };

  const removeSkill = (index: number) => {
    onChange({ ...data, skills: skills.filter((_: any, i: number) => i !== index) });
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkill(e.currentTarget.value);
      e.currentTarget.value = "";
    }
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Skills
        </h3>
        <div className="flex items-center gap-2">
          <AIVersionNavigator state={aiVersionNavigator} />
          {onAIAssist && (
            <button
              onClick={() => onAIAssist(data.blockId)}
              className="px-3 py-1 rounded-lg flex items-center gap-1.5"
              style={{
                fontSize: "12px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
              }}
            >
              <Sparkles size={12} />
              Suggest skills
            </button>
          )}
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {!isHidden && (
        <div className="space-y-3">
          {suggestionPoolPanel}
          <div className="flex flex-wrap gap-2">
            {skills.map((skill: string, index: number) => (
              <span
                key={index}
                className="px-3 py-1.5 rounded-full flex items-center gap-2"
                style={{
                  fontSize: "12px",
                  background: "var(--color-slate-50)",
                  color: "var(--color-text-primary)",
                }}
              >
                {skill}
                <button onClick={() => removeSkill(index)} style={{ color: "var(--color-text-secondary)" }}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            placeholder="Type a skill and press Enter"
            onKeyPress={handleKeyPress}
            className="w-full px-3 py-2 rounded-lg border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
              background: "var(--color-background-primary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// Language section with proficiency and certification support
interface LanguageSectionProps {
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

interface LanguageItemProps {
  item: any;
  index: number;
  updateItem: (index: number, item: any) => void;
  removeItem: (index: number) => void;
  toggleItemVisibility: (index: number) => void;
  toggleItemCollapsed: (index: number) => void;
  moveItem: (dragIndex: number, hoverIndex: number) => void;
  proficiencyLevels: string[];
}

function LanguageItem({ item, index, updateItem, removeItem, toggleItemVisibility, toggleItemCollapsed, moveItem, proficiencyLevels }: LanguageItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag({
    type: "LANGUAGE_ITEM",
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: "LANGUAGE_ITEM",
    hover: (draggedItem: { index: number }) => {
      if (draggedItem.index !== index) {
        moveItem(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
  });

  drag(drop(ref));

  const isCollapsed = item.collapsed;

  return (
    <div
      ref={ref}
      className="p-3 rounded-lg border space-y-2"
      style={{
        borderColor: "var(--color-border-tertiary)",
        opacity: item.hidden ? 0.5 : isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div style={{ cursor: "grab", color: "var(--color-text-secondary)" }}>
            <GripVertical size={14} />
          </div>
          <button
            onClick={() => toggleItemCollapsed(index)}
            className="hover:bg-[var(--color-background-secondary)] rounded p-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isCollapsed && (
            <div className="flex-1 min-w-0" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
              <div className="truncate font-medium">
                {item.language || "Language"}
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                {item.proficiency || "Proficiency level"} {item.certificate && `• ${item.certificate}`}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
            {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isCollapsed && !item.hidden && (
        <div className="space-y-2 pl-8">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Language"
              value={item.language}
              onChange={(e) => updateItem(index, { ...item, language: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
              }}
            />
            <select
              value={item.proficiency}
              onChange={(e) => updateItem(index, { ...item, proficiency: e.target.value })}
              className="px-2 py-1.5 rounded border"
              style={{
                fontSize: "13px",
                borderColor: "var(--color-border-secondary)",
                background: "var(--color-background-primary)",
              }}
            >
              <option value="">Select proficiency</option>
              {proficiencyLevels.map(level => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            placeholder="Certificate/Score (optional, e.g. IELTS 7.5, TOEFL 105)"
            value={item.certificate || ""}
            onChange={(e) => updateItem(index, { ...item, certificate: e.target.value })}
            className="w-full px-2 py-1.5 rounded border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
            }}
          />
          <textarea
            rows={2}
            placeholder="Notes (optional)"
            value={item.notes || ""}
            onChange={(e) => updateItem(index, { ...item, notes: e.target.value })}
            className="w-full px-2 py-1.5 rounded border resize-none"
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              borderColor: "var(--color-border-secondary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function LanguageSection({ data, isHidden, onToggleVisibility, onRemove, onChange }: LanguageSectionProps) {
  const items = data.items || [];

  const proficiencyLevels = [
    "Native",
    "Professional",
    "Advanced",
    "Intermediate",
    "Basic",
    "Limited"
  ];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), language: "", proficiency: "", certificate: "", notes: "", hidden: false, collapsed: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  const toggleItemCollapsed = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], collapsed: !newItems[index].collapsed };
    onChange({ ...data, items: newItems });
  };

  const moveItem = (dragIndex: number, hoverIndex: number) => {
    const newItems = [...items];
    const draggedItem = newItems[dragIndex];
    newItems.splice(dragIndex, 1);
    newItems.splice(hoverIndex, 0, draggedItem);
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          Languages
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <LanguageItem
              key={item.id}
              item={item}
              index={index}
              updateItem={updateItem}
              removeItem={removeItem}
              toggleItemVisibility={toggleItemVisibility}
              toggleItemCollapsed={toggleItemCollapsed}
              moveItem={moveItem}
              proficiencyLevels={proficiencyLevels}
            />
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add language</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Generic section for other content types
interface GenericSectionProps {
  title: string;
  data: any;
  isHidden: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onChange: (data: any) => void;
}

export function GenericSection({ title, data, isHidden, onToggleVisibility, onRemove, onChange }: GenericSectionProps) {
  const items = data.items || [];

  const addItem = () => {
    onChange({
      ...data,
      items: [...items, { id: Date.now(), title: "", subtitle: "", dates: "", description: "", hidden: false }],
    });
  };

  const updateItem = (index: number, updatedItem: any) => {
    const newItems = [...items];
    newItems[index] = updatedItem;
    onChange({ ...data, items: newItems });
  };

  const removeItem = (index: number) => {
    onChange({ ...data, items: items.filter((_: any, i: number) => i !== index) });
  };

  const toggleItemVisibility = (index: number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], hidden: !newItems[index].hidden };
    onChange({ ...data, items: newItems });
  };

  return (
    <div
      className="p-4 rounded-xl border"
      style={{
        background: "var(--color-background-primary)",
        borderColor: "var(--color-border-tertiary)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
          <GripVertical size={14} style={{ color: "var(--color-text-secondary)", cursor: "grab" }} />
          {title}
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onToggleVisibility} style={{ color: "var(--color-text-secondary)" }}>
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={onRemove} style={{ color: "var(--color-text-secondary)" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!isHidden && (
        <div className="space-y-4">
          {items.map((item: any, index: number) => (
            <div
              key={item.id}
              className="p-3 rounded-lg border space-y-2"
              style={{
                borderColor: "var(--color-border-tertiary)",
                opacity: item.hidden ? 0.5 : 1,
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-2">
                  {!item.hidden && (
                    <>
                      <input
                        type="text"
                        placeholder="Title"
                        value={item.title}
                        onChange={(e) => updateItem(index, { ...item, title: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border"
                        style={{
                          fontSize: "13px",
                          borderColor: "var(--color-border-secondary)",
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Subtitle (optional)"
                        value={item.subtitle}
                        onChange={(e) => updateItem(index, { ...item, subtitle: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border"
                        style={{
                          fontSize: "13px",
                          borderColor: "var(--color-border-secondary)",
                        }}
                      />
                      <DateInputHelper
                        value={item.dates || ""}
                        placeholder="Dates (optional)"
                        onChange={(nextValue) => updateItem(index, { ...item, dates: nextValue })}
                      />
                      <BulletTextarea
                        rows={2}
                        placeholder="Description (optional)"
                        value={item.description || ""}
                        onValueChange={(next) => updateItem(index, { ...item, description: next })}
                        className="w-full px-2 py-1.5 rounded border resize-none"
                        style={{
                          fontSize: "13px",
                          lineHeight: "1.6",
                          borderColor: "var(--color-border-secondary)",
                        }}
                      />
                    </>
                  )}
                </div>
                <div className="ml-2 flex flex-col gap-1">
                  <button onClick={() => toggleItemVisibility(index)} style={{ color: "var(--color-text-secondary)" }}>
                    {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button onClick={() => removeItem(index)} style={{ color: "var(--color-text-secondary)" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addItem}
            className="w-full py-2 rounded-lg border-2 border-dashed flex items-center justify-center gap-2"
            style={{ borderColor: "var(--color-border-tertiary)", color: "var(--color-teal-600)" }}
          >
            <Plus size={14} />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Add item</span>
          </button>
        </div>
      )}
    </div>
  );
}

export * from "./SpecializedSections";
