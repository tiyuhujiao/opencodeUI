import { useMemo, useState } from 'react'
import { buildV2FormAnswer, validateV2FormAnswer, type V2FormAnswer, type V2FormDraft, type V2FormInfo } from '../../../src/shared/opencodeV2Form'
import { useI18n } from '../i18n'
import { updateV2FormDraft, V2FormFields } from './V2FormFields'

export function V2QuestionBanner({ form, onReply, onReject }: {
  form: V2FormInfo
  onReply: (questionId: string, answer: V2FormAnswer) => void
  onReject: (questionId: string) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<V2FormDraft>({})
  const answer = useMemo(() => buildV2FormAnswer(form.fields, draft), [form.fields, draft])
  const valid = Object.keys(validateV2FormAnswer(form.fields, answer)).length === 0
  return (
    <form className="question-banner question-banner--native" noValidate onSubmit={(event) => {
      event.preventDefault()
      if (valid) onReply(form.id, answer)
    }}>
      <div className="question-banner__header"><span>{form.title || t('Question needs input')}</span></div>
      <div className="question-banner__body">
        <V2FormFields fields={form.fields} answer={answer}
          onChange={(key, value) => setDraft((current) => updateV2FormDraft(current, key, value))} />
      </div>
      <div className="question-banner__actions">
        <button type="submit" disabled={!valid}>{t('Reply')}</button>
        <button type="button" onClick={() => onReject(form.id)}>{t('Dismiss')}</button>
      </div>
    </form>
  )
}
