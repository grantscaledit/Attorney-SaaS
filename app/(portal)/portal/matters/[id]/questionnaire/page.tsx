import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/panel";
import { requireClient } from "@/lib/auth/session";
import { portalMatter } from "@/modules/matters/queries";
import { ESTATE_QUESTIONNAIRE } from "@/modules/matters/questionnaire";
import { QuestionnaireForm } from "./form";

export const metadata: Metadata = { title: "Estate planning questionnaire" };

export default async function QuestionnairePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireClient();
  const m = await portalMatter(user, (await params).id);
  if (!m || !m.questionnaire) notFound();
  return (
    <>
      <PageHeader
        eyebrow={`Matter ${m.number}`}
        title="Estate planning questionnaire"
        description="Answer what you can; your attorney will go through it with you. Use ages rather than dates of birth, and do not enter account numbers."
      />
      {m.questionnaire.status === "submitted" ? (
        <Notice tone="good">
          You submitted this questionnaire. Contact the firm to change an answer.
        </Notice>
      ) : (
        <QuestionnaireForm
          matterId={m.id}
          sections={ESTATE_QUESTIONNAIRE}
          initial={m.questionnaire.answers}
        />
      )}
    </>
  );
}
