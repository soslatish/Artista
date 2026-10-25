import { useState } from 'react';

import { errorText, fieldErrors, post } from '@/api/client';
import { AdminScreen, ChipFilter, ConfirmAction, Section } from '@/features/admin/ui';
import { Field, Notice, T } from '@/ui/primitives';

const audiences = [
  { value: 'all', label: 'Все пользователи' },
  { value: 'buyers', label: 'Покупатели' },
  { value: 'artists', label: 'Художники' },
  { value: 'premium', label: 'С Премиумом' },
];

export default function AdminBroadcast() {
  const [audience, setAudience] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');

  const send = async () => {
    setErrors({});
    setResult('');
    try {
      const r = await post<{ sent: number }>('/admin/broadcast', { audience, title, body, title_en: titleEn, body_en: bodyEn });
      setResult(`Отправлено: ${r.sent}`);
      setTitle('');
      setBody('');
      setTitleEn('');
      setBodyEn('');
    } catch (e) {
      setErrors(fieldErrors(e));
      throw new Error(errorText(e));
    }
  };

  return (
    <AdminScreen title="Рассылка" subtitle="Уведомление в приложении и push">
      <Section title="Кому">
        <ChipFilter options={audiences} value={audience} onChange={setAudience} />
      </Section>
      <Section title="Текст">
        <Field label="Заголовок" value={title} onChangeText={setTitle} maxLength={100} error={errors.title} />
        <Field label="Сообщение" value={body} onChangeText={setBody} multiline maxLength={500} error={errors.body} />
      </Section>
      <Section title="Для англоязычных пользователей">
        <T variant="small">Необязательно. Если не заполнить, они получат русский текст.</T>
        <Field label="Title" value={titleEn} onChangeText={setTitleEn} maxLength={100} />
        <Field label="Message" value={bodyEn} onChangeText={setBodyEn} multiline maxLength={500} error={errors.body_en} />
      </Section>
      {result ? <Notice tone="success" text={result} /> : null}
      <ConfirmAction title="Отправить рассылку" confirmTitle="Отправить" description="Отменить отправку нельзя." variant="primary" onConfirm={send} />
    </AdminScreen>
  );
}
