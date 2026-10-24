import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Mail, Copy, Check, ArrowRight } from "lucide-react";
import { PublicHeader } from "../components/PublicHeader";
import { publicPath, translate as t } from "../localization/i18n";
import { SUPPORT_EMAIL, supportEmailHref } from "../integration/support";
import "./support.css";

const questions = [
  { title: "How does the 3-day free trial work?", answer: "Start by uploading a CV or creating a new one, answer the onboarding questions, and review your CV Score. Choose your next step, then activate the trial with a credit card to use the app. After 3 days, Weekly Pro renews automatically at the price shown at checkout unless you cancel before the trial ends.", link: "/pricing", label: "View plans and trial details" },
  { title: "How do I cancel my trial or subscription?", answer: "Sign in, open Pricing in the app, and use the billing portal to manage or cancel your subscription. You can cancel at any time. Cancel before your trial ends to avoid the first charge. Check the portal for your cancellation status and access end date.", link: "/app/pricing", label: "Open billing settings" },
  { title: "I used the free version before. What changed?", answer: "Existing users can keep viewing and manually editing their saved CVs for free. Exports, AI tools, and job tailoring require an active trial or Pro subscription. Existing users also receive a one-time fresh 3-day trial opportunity, even if they used a trial before. Sign in to check your offer; current active subscriptions continue unchanged.", link: "/signin", label: "Sign in to your account" },
  { title: "My payment failed. What should I do?", answer: "Return to checkout and retry after checking your payment details. If you are eligible, you can choose the 3-day free trial instead. If a payment appears on your statement but the app is still locked, email support with your account email and the approximate payment time." },
  { title: "Why is my CV upload not working?", answer: "Upload a PDF or DOCX file that is not empty and is no larger than 20 MB. If analysis fails, try again or create a new CV instead. If the problem continues, email support with the error message and file type." },
  { title: "How do I download my CV?", answer: "Open your CV in the editor and use its export options to download PDF or DOCX. An active trial or subscription is required. If an export fails, retry and contact support with the format you selected and any error message." },
  { title: "I cannot sign in. How can I get help?", answer: "Use the same sign-in method you used when you created your account. For email and password accounts, use the password reset link. You can always email support without signing in.", link: "/forgot-password", label: "Reset your password" },
];

export default function Support() {
  useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyEmail = async () => {
    try { await navigator.clipboard.writeText(SUPPORT_EMAIL); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  };
  return <div className="support-page">
    <PublicHeader />
    <main className="support-main">
      <header className="support-intro">
        <span className="support-eyebrow">{t("JobSpecificCV support")}</span>
        <h1>{t("A little help for your next step.")}</h1>
        <p>{t("Find answers about your CV, trial, and subscription, or get in touch with us directly.")}</p>
        <a className="support-jump" href="#contact">{t("Contact support")} <ArrowRight size={16} aria-hidden="true" /></a>
      </header>
      <div className="support-columns">
        <section aria-labelledby="support-questions">
          <h2 id="support-questions">{t("Common questions")}</h2>
          <div className="support-faqs">
            {questions.map(question => <details key={question.title}>
              <summary>{t(question.title)}</summary>
              <div className="support-answer"><p>{t(question.answer)}</p>
                {question.link && question.label && <Link to={question.link === "/pricing" ? publicPath(question.link) : question.link}>{t(question.label)}</Link>}
              </div>
            </details>)}
          </div>
        </section>
        <section id="contact" className="support-contact" aria-labelledby="support-contact-heading">
          <Mail size={28} aria-hidden="true" />
          <h2 id="support-contact-heading">{t("Talk to us")}</h2>
          <p>{t("Need a hand? Email us and we will help you find the next step.")}</p>
          <a className="support-email" href={supportEmailHref()}>{SUPPORT_EMAIL}</a>
          <div className="support-actions">
            <a className="support-email-button" href={supportEmailHref()}><Mail size={17} aria-hidden="true" />{t("Email support")}</a>
            <button type="button" onClick={() => void copyEmail()}>{copyState === "copied" ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}{t(copyState === "copied" ? "Email copied" : "Copy email address")}</button>
          </div>
          <p className="support-copy-status" role="status">{copyState === "copied" ? t("Email address copied to clipboard.") : copyState === "failed" ? t("Copy is unavailable. Select and copy the email address above.") : ""}</p>
          <p className="support-contact-note">{t("To help us investigate, include your account email, what you were trying to do, and the exact error message. A screenshot can also help.")}</p>
          <p className="support-contact-note">{t("No email app set up? Copy our address and send your message from Gmail or your preferred email service.")}</p>
        </section>
      </div>
      <footer className="support-footer"><Link to={publicPath("/")}>{t("Back to home")}</Link><Link to={publicPath("/pricing")}>{t("Pricing")}</Link></footer>
    </main>
  </div>;
}
