import { useId, useState } from 'react'
import {
  isV2FormActive, validateV2FormAnswer,
  type V2FormAnswer, type V2FormDraft, type V2FormField, type V2FormValue
} from '../../../src/shared/opencodeV2Form'
import { useI18n } from '../i18n'
import { createRequestId, getVsCodeApi } from '../vscodeApi'
import './v2Form.css'

function openExternal(url: string) {
  getVsCodeApi()?.postMessage({
    type: 'provider.auth.openExternal', requestId: createRequestId(), payload: { url }
  })
}

function safeExternalUrl(url: string) {
  try { return ['https:', 'http:'].includes(new URL(url).protocol) } catch { return false }
}

export function V2FormFields({ fields, answer, onChange, disabled = false }: {
  fields: V2FormField[]
  answer: V2FormAnswer
  onChange: (key: string, value: V2FormValue | undefined) => void
  disabled?: boolean
}) {
  const { t } = useI18n()
  const prefix = useId()
  const [custom, setCustom] = useState<Record<string, string>>({})
  const errors = validateV2FormAnswer(fields, answer)
  const errorText = (message: string) => {
    const separator = message.indexOf(': ')
    return separator < 0 ? t(message) : t('{reason}: {field}', {
      reason: t(message.slice(0, separator)), field: message.slice(separator + 2)
    })
  }
  return (
    <div className="v2-form-fields">
      {fields.filter((field) => (field.type === 'external' || !field.hidden) && isV2FormActive(field, answer)).map((field) => {
        const id = `${prefix}-${field.key}`
        const value = answer[field.key]
        const label = field.title || field.key
        const options = field.type === 'string' || field.type === 'multiselect' ? field.options : undefined
        const multiple = field.type === 'multiselect'
        const selected = Array.isArray(value) ? value : []
        const updateOption = (option: string) => {
          onChange(field.key, multiple
            ? selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]
            : option)
        }
        return (
          <fieldset key={field.key} className="v2-form-field" disabled={disabled}>
            <legend>
              <label htmlFor={id}>{label}</label>
              {field.type !== 'external' && !field.required ? <span className="v2-form-field__optional">{t('Optional')}</span> : null}
            </legend>
            {field.description && field.description !== label ? <p className="v2-form-field__description">{field.description}</p> : null}
            {field.type === 'external' ? (
              <div className="v2-form-field__external">
                <button type="button" onClick={() => openExternal(field.url)} disabled={!safeExternalUrl(field.url)}>
                  {t('Open authorization page')}
                </button>
                <label>
                  <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(field.key, event.target.checked)} />
                  <span>{t('I have completed this step')}</span>
                </label>
              </div>
            ) : field.type === 'boolean' ? (
              <select id={id} value={value === undefined ? '' : String(value)} aria-invalid={Boolean(errors[field.key])}
                onChange={(event) => onChange(field.key, event.target.value === '' ? undefined : event.target.value === 'true')}>
                <option value="">{t('Choose an answer')}</option>
                <option value="true">{t('Yes')}</option>
                <option value="false">{t('No')}</option>
              </select>
            ) : field.type === 'integer' || field.type === 'number' ? (
              <input id={id} type="number" value={value === undefined ? '' : String(value)}
                min={field.minimum} max={field.maximum} step={field.type === 'integer' ? 1 : 'any'}
                aria-invalid={Boolean(errors[field.key])}
                onChange={(event) => onChange(field.key, event.target.value === '' ? undefined : Number(event.target.value))} />
            ) : (
              <div className="v2-form-field__choices">
                {options?.map((option) => (
                  <label key={option.value} className="v2-form-field__choice">
                    <input type={multiple ? 'checkbox' : 'radio'} name={id}
                      checked={multiple ? selected.includes(option.value) : value === option.value}
                      onChange={() => updateOption(option.value)} />
                    <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
                  </label>
                ))}
                {field.type === 'string' && (field.options === undefined || field.custom === true) ? (
                  <input id={id} type="text" value={typeof value === 'string' ? value : ''}
                    placeholder={field.placeholder ?? (field.options ? t('Custom answer') : undefined)}
                    aria-invalid={Boolean(errors[field.key])} onChange={(event) => onChange(field.key, event.target.value)} />
                ) : field.type === 'multiselect' && field.custom === true ? (
                  <div className="v2-form-field__custom">
                    <input id={id} value={custom[field.key] ?? ''} placeholder={t('Custom answer')}
                      onChange={(event) => setCustom((current) => ({ ...current, [field.key]: event.target.value }))} />
                    <button type="button" disabled={!custom[field.key]} onClick={() => {
                      const next = custom[field.key]
                      if (next && !selected.includes(next)) onChange(field.key, [...selected, next])
                      setCustom((current) => ({ ...current, [field.key]: '' }))
                    }}>{t('Add')}</button>
                  </div>
                ) : null}
                {multiple ? selected.filter((item) => !options?.some((option) => option.value === item)).map((item) => (
                  <button key={item} type="button" className="v2-form-field__custom-value" onClick={() => updateOption(item)}>{item} ×</button>
                )) : null}
              </div>
            )}
            {field.type !== 'external' && !field.required && value !== undefined ? (
              <button type="button" className="v2-form-field__skip" onClick={() => onChange(field.key, undefined)}>{t('Skip this field')}</button>
            ) : null}
            {errors[field.key] ? <output className="v2-form-field__error">{errorText(errors[field.key])}</output> : null}
          </fieldset>
        )
      })}
      {fields.filter((field) => field.type !== 'external' && field.hidden && errors[field.key]).map((field) => (
        <output key={field.key} className="v2-form-field__error">{errorText(errors[field.key])}</output>
      ))}
    </div>
  )
}

export function updateV2FormDraft(draft: V2FormDraft, key: string, value: V2FormValue | undefined): V2FormDraft {
  return { ...draft, [key]: value }
}
