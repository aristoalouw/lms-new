import get from 'lodash/get.js'
import moment from 'moment'
import 'moment/locale/id'

moment.locale('id')

export const useFormatters = () => {
  const currency = (value: number, currencyCode = 'IDR') => new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(value)

  const number = (value: number) => new Intl.NumberFormat('id-ID').format(value)
  const date = (value: string | Date, format = 'D MMMM YYYY') => moment(value).format(format)
  const relativeTime = (value: string | Date) => moment(value).fromNow()
  const valueAt = (item: unknown, path: string, fallback = '—') => get(item, path, fallback)

  return { currency, number, date, relativeTime, valueAt }
}
