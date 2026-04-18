import { X, Briefcase, GraduationCap, Languages, Award, FileText, Lightbulb, Heart, BookOpen, Users } from "lucide-react";

interface ContentType {
  id: string;
  name: string;
  icon: any;
  essential: boolean;
  description: string;
}

const contentTypes: ContentType[] = [
  { id: "summary", name: "Professional Summary", icon: FileText, essential: true, description: "Brief overview of your experience" },
  { id: "experience", name: "Work Experience", icon: Briefcase, essential: true, description: "Your employment history" },
  { id: "education", name: "Education", icon: GraduationCap, essential: true, description: "Academic qualifications" },
  { id: "skills", name: "Skills", icon: Lightbulb, essential: true, description: "Technical and soft skills" },
  { id: "languages", name: "Languages", icon: Languages, essential: false, description: "Languages you speak" },
  { id: "certifications", name: "Certifications", icon: Award, essential: false, description: "Professional certificates" },
  { id: "courses", name: "Courses", icon: BookOpen, essential: false, description: "Relevant courses and training" },
  { id: "projects", name: "Projects", icon: FileText, essential: false, description: "Personal or professional projects" },
  { id: "volunteer", name: "Volunteer Work", icon: Heart, essential: false, description: "Volunteer experience" },
  { id: "awards", name: "Awards", icon: Award, essential: false, description: "Recognition and achievements" },
  { id: "publications", name: "Publications", icon: BookOpen, essential: false, description: "Articles, papers, or books" },
  { id: "references", name: "References", icon: Users, essential: false, description: "Professional references" },
];

interface AddContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSection: (sectionId: string) => void;
  existingSections: string[];
}

export function AddContentModal({ isOpen, onClose, onAddSection, existingSections }: AddContentModalProps) {
  if (!isOpen) return null;

  const availableContent = contentTypes.filter(
    (content) => !existingSections.includes(content.id)
  );

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 max-w-2xl w-full shadow-2xl"
        style={{ background: "var(--color-background-primary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-medium" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
            Add Content Section
          </h3>
          <button onClick={onClose} style={{ color: "var(--color-text-secondary)" }}>
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {availableContent.map((content) => {
            const Icon = content.icon;
            return (
              <button
                key={content.id}
                onClick={() => {
                  onAddSection(content.id);
                  onClose();
                }}
                className="p-4 rounded-xl border text-left transition-all hover:shadow-md relative group"
                style={{
                  background: "var(--color-background-primary)",
                  borderColor: "var(--color-border-tertiary)",
                  ...(content.essential && {
                    borderWidth: "2px",
                    borderColor: "transparent",
                    backgroundImage: `
                      linear-gradient(var(--color-background-primary), var(--color-background-primary)),
                      linear-gradient(135deg, var(--color-teal-400), var(--color-teal-600), var(--color-teal-400))
                    `,
                    backgroundOrigin: "border-box",
                    backgroundClip: "padding-box, border-box",
                  }),
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: content.essential ? "var(--color-teal-50)" : "var(--color-slate-50)",
                    }}
                  >
                    <Icon size={18} style={{ color: content.essential ? "var(--color-teal-600)" : "var(--color-text-secondary)" }} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium mb-1" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                      {content.name}
                    </h4>
                    <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: "1.4" }}>
                      {content.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {availableContent.length === 0 && (
          <p className="text-center py-8" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            All content sections have been added
          </p>
        )}
      </div>
    </div>
  );
}
