"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import type { ActionState } from "@/lib/commands/action-state";
import type { SectionDef } from "@/modules/matters/questionnaire";
import { saveQuestionnaireAction } from "./actions";

export function QuestionnaireForm({
  matterId,
  sections,
  initial,
}: {
  matterId: string;
  sections: SectionDef[];
  initial: Record<string, string>;
}) {
  const [answers, setAnswers] = useState(initial);
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  const submitted = state?.status === "success" && (state.message ?? "").startsWith("Submitted");
  const masked =
    state?.status === "success" && (state.data as { masked?: boolean } | undefined)?.masked;
  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <Panel key={s.key}>
          <PanelHeader title={s.title} />
          <PanelBody className="space-y-4">
            {s.questions.map((q) => (
              <Field key={q.id} id={q.id} label={q.label} hint={q.help} optional>
                {q.long ? (
                  <Textarea
                    id={q.id}
                    value={answers[q.id] ?? ""}
                    disabled={submitted}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  />
                ) : (
                  <Input
                    id={q.id}
                    value={answers[q.id] ?? ""}
                    disabled={submitted}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          </PanelBody>
        </Panel>
      ))}
      {state && state.status !== "idle" ? (
        <Notice tone={state.status === "success" ? "good" : "critical"}>
          {state.message}
          {masked ? " Some numbers were masked to protect your privacy." : ""}
        </Notice>
      ) : null}
      {!submitted ? (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => setState(await saveQuestionnaireAction(matterId, answers, false)))
            }
          >
            Save and finish later
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => setState(await saveQuestionnaireAction(matterId, answers, true)))
            }
          >
            Submit to the firm
          </Button>
        </div>
      ) : null}
    </div>
  );
}
