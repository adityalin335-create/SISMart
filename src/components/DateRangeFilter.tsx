import { useEffect, useState } from 'react';
import { endOfDay, endOfMonth, format, parseISO, startOfDay, startOfMonth, subDays, subMonths } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface DateRange {
  from?: Date;
  to?: Date;
}

type QuickRange = 'today' | 'yesterday' | '7days' | '30days' | 'thisMonth' | 'lastMonth';

function toInputDate(date?: Date) {
  return date ? format(date, 'yyyy-MM-dd') : '';
}

function fromInputDate(value: string) {
  return value ? parseISO(value) : undefined;
}

function getQuickRange(range: QuickRange, now = new Date()): Required<DateRange> {
  switch (range) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const yesterday = subDays(now, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }
    case '7days':
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case '30days':
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case 'thisMonth':
      return { from: startOfMonth(now), to: endOfDay(now) };
    case 'lastMonth': {
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    }
  }
}

export default function DateRangeFilter({
  value,
  onApply,
  onReset,
}: {
  value: DateRange;
  onApply: (range: DateRange) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation('settings');
  const [from, setFrom] = useState(toInputDate(value.from));
  const [to, setTo] = useState(toInputDate(value.to));
  const valueFrom = toInputDate(value.from);
  const valueTo = toInputDate(value.to);

  useEffect(() => {
    setFrom(valueFrom);
    setTo(valueTo);
  }, [valueFrom, valueTo]);

  const chooseQuickRange = (range: QuickRange) => {
    const dates = getQuickRange(range);
    setFrom(toInputDate(dates.from));
    setTo(toInputDate(dates.to));
  };

  const invalidRange = Boolean(from && to && from > to);
  const quickRanges: QuickRange[] = ['today', 'yesterday', '7days', '30days', 'thisMonth', 'lastMonth'];

  return (
    <section aria-label={t('dateFilter.title')} className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap gap-1.5">
        {quickRanges.map(range => (
          <Button
            key={range}
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={() => chooseQuickRange(range)}
          >
            {t(`dateFilter.quick.${range}`)}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{t('dateFilter.from')}</span>
          <Input type="date" value={from} onChange={event => setFrom(event.target.value)} className="h-9 text-sm" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{t('dateFilter.to')}</span>
          <Input type="date" value={to} onChange={event => setTo(event.target.value)} className="h-9 text-sm" />
        </label>
      </div>
      {invalidRange && <p role="alert" className="text-xs text-destructive">{t('dateFilter.invalidRange')}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); onReset(); }}>
          {t('dateFilter.reset')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={invalidRange}
          onClick={() => onApply({ from: fromInputDate(from), to: fromInputDate(to) })}
        >
          {t('dateFilter.show')}
        </Button>
      </div>
    </section>
  );
}
