import type { Employee } from './types';
import type { WorkerColumn } from './model';
import { calendarDate } from './types';

export async function exportWorkers(employees: Employee[], columns: WorkerColumn[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [columns.map(column => ({ value: column.title, fontWeight: 'bold' as const, color: '#FFFFFF', backgroundColor: column.resource === 'water' ? '#036985' : column.resource === 'energy' ? '#92400E' : '#26374D', wrap: true, height: 38 })),
    ...employees.map((employee, index) => columns.map(column => {
      const raw = column.value(employee);
      return { value: column.kind === 'date' ? calendarDate(String(raw ?? '')) : raw ?? '—',
        backgroundColor: column.resource === 'water' ? (index % 2 ? '#E0F2FE' : '#F0F9FF') : column.resource === 'energy' ? (index % 2 ? '#FEF3C7' : '#FFFBEB') : index % 2 ? '#EDF2F7' : '#FFFFFF',
        color: '#18212F', height: 26, borderColor: '#DCE1E8', borderBottomStyle: 'thin' as const };
    }))];
  await writeXlsxFile(data, { sheet: 'Рабочие', columns: columns.map(c => ({ width: c.kind === 'text' ? 24 : c.resource ? 23 : 21 })) }).toFile('Рабочие.xlsx');
}
