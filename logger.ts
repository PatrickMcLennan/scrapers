import { format } from 'date-fns';

export function timeStamp(): string {
    return `[${format(new Date(), `dd/MM/yyyy|HH:mm`)}]`;
  }
  