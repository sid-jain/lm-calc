import { formatContext } from './contextSnaps';
import type { RejectionReason } from './recommender';

export function rejectionLabel(reason: RejectionReason): string {
  switch (reason.type) {
    case 'no_quant_fits_ram':
      return `Needs ≥${reason.minRamGB.toFixed(1)} GB`;
    case 'too_slow':
      return `Max ${reason.maxLowTps < 1 ? '<1' : Math.round(reason.maxLowTps)} tok/s`;
    case 'context_too_short':
      return `Max ${formatContext(reason.maxContext)} ctx`;
    case 'excluded_dev':
      return 'Dev excluded';
  }
}
