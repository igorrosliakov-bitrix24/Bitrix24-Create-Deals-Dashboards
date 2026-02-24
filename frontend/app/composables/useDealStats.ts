import { ref, computed } from 'vue'
import type { B24Frame } from '@bitrix24/b24jssdk'

/**
 * ПАСПОРТ ИЗМЕНЕНИЙ ФАЙЛА
 * ТИП: СОЗДАНИЕ
 * - Новый composable расчёта KPI по сделкам для вкладок контакта и компании.
 * - Реализована загрузка всех страниц crm.deal.list и устойчивое определение статуса сделки.
 * - Добавлен учёт валюты отдельно по каждому KPI-бакету.
 * УДАЛЕНИЕ:
 * - Легаси-блока в этом файле не было (файл создан с нуля).
 */

export interface DealStats {
  revenue: number        // Полученная выручка (выигранные закрытые сделки)
  lost: number           // Потерянная выручка (проигранные закрытые сделки)
  potential: number      // Потенциальная выручка (открытые сделки)
  revenueCurrency: string
  lostCurrency: string
  potentialCurrency: string
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/**
 * Composable для получения статистики по сделкам контакта или компании
 * 
 * @param b24 - Инициализированный B24Frame объект
 * @param entityId - ID контакта или компании
 * @param entityType - 'contact' или 'company'
 * @returns объект с статистикой и методом refresh
 */
export const useDealStats = (
  b24: B24Frame,
  entityId: number | string,
  entityType: 'contact' | 'company' = 'contact'
): DealStats => {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const revenue = ref(0)
  const lost = ref(0)
  const potential = ref(0)
  /**
   * [REPLACED BLOCK]
   * Предыдущее поведение:
   * - одна общая валюта на весь дашборд.
   * Текущее поведение:
   * - отдельная валюта для каждого KPI-бакета (revenue/lost/potential).
   * Зачем:
   * - сделки могут быть в разных валютах.
   */
  // Ведём валюту отдельно по каждому KPI, чтобы не показывать одну вводящую в заблуждение валюту.
  const revenueCurrency = ref('')
  const lostCurrency = ref('')
  const potentialCurrency = ref('')

  /**
   * [NEW BLOCK]
   * Нормализует значение валюты для отображения.
   */
  // Нормализация валюты делает UI предсказуемым при пустых/невалидных значениях API.
  const normalizeCurrency = (value: unknown): string => {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().toUpperCase()
    }
    return 'USD'
  }

  const updateBucketCurrency = (
    currentCurrency: { value: string },
    nextCurrency: string
  ) => {
    /**
     * [NEW BLOCK]
     * Политика валюты бакета:
     * - первая встреченная валюта становится валютой бакета;
     * - если позже встречается другая валюта, переключаем бакет на MIX.
     */
    // Первое значение задаёт валюту бакета, смешанные валюты переключают бакет в "MIX".
    if (!currentCurrency.value) {
      currentCurrency.value = nextCurrency
      return
    }

    if (currentCurrency.value !== nextCurrency && currentCurrency.value !== 'MIX') {
      currentCurrency.value = 'MIX'
    }
  }

  /**
   * Загрузить данные о сделках
   * Используем crm.deal.list с фильтром по CONTACT_ID или COMPANY_ID
   * Определяем статус через STAGE_SEMANTIC:
   *   - 'WON' = выигранная (revenue)
   *   - 'LOST' = проигранная (lost)
   *   - остальное с CLOSED != 'Y' = открытая (potential)
   */
  const fetchDeals = async () => {
    try {
      loading.value = true
      error.value = null
      revenue.value = 0
      lost.value = 0
      potential.value = 0
      revenueCurrency.value = ''
      lostCurrency.value = ''
      potentialCurrency.value = ''

      // Определяем поле фильтра в зависимости от типа сущности
      const filterField = entityType === 'contact' ? 'CONTACT_ID' : 'COMPANY_ID'

      /**
       * [REPLACED BLOCK]
       * Предыдущее поведение:
       * - callMethod('crm.deal.list', { limit: 50 }) и обработка только одной страницы.
       * Текущее поведение:
       * - итератор fetchListMethod по всем страницам (без скрытого усечения).
       *
       * [REMOVED LEGACY BLOCK]
       * - Удалён старый сценарий с фиксированным limit=50.
       */
      // Загружаем все сделки через чанки, чтобы исключить усечение по размеру страницы.
      const deals: any[] = []
      // Итерируемся по всем страницам ответа API, чтобы не терять сделки при объёме > 50.
      for await (const chunk of b24.fetchListMethod('crm.deal.list', {
        filter: {
          [filterField]: entityId
        },
        select: ['ID', 'OPPORTUNITY', 'STAGE_SEMANTIC', 'STAGE_ID', 'CLOSED', 'CURRENCY_ID']
      }, 'ID')) {
        if (Array.isArray(chunk)) {
          for (const item of chunk) {
            if (item && typeof item === 'object') {
              deals.push(item)
            }
          }
        }
      }

      if (deals.length === 0) {
        // Пустой набор сделок не является ошибкой: возвращаем нулевые KPI.
        return
      }

      /**
       * [REPLACED BLOCK]
       * Классификация статуса теперь использует два источника:
       * - STAGE_SEMANTIC (основной)
       * - fallback по суффиксам STAGE_ID (для порталов с неполной semantic-разметкой)
       */
      // Агрегируем сделки по бизнес-смыслу:
      // выиграна+закрыта -> полученная выручка, проиграна+закрыта -> потерянная, открыта -> потенциальная.
      for (const deal of deals) {
        if (!deal || typeof deal !== 'object') {
          continue
        }

        const amount = parseFloat(deal.OPPORTUNITY) || 0
        const stageSemantic = String(deal.STAGE_SEMANTIC || '').toUpperCase()
        const stageId = String(deal.STAGE_ID || '').toUpperCase()
        const isClosed = deal.CLOSED === 'Y' || deal.CLOSED === true
        const currency = normalizeCurrency(deal.CURRENCY_ID)

        // На части порталов STAGE_SEMANTIC приходит неполным, поэтому используем резервную проверку по суффиксам STAGE_ID.
        const isWon = stageSemantic === 'WON'
          || stageId === 'WON'
          || stageId.endsWith(':WON')
        const isLost = stageSemantic === 'LOSE'
          || stageSemantic === 'LOST'
          || stageId === 'LOSE'
          || stageId === 'LOST'
          || stageId.endsWith(':LOSE')
          || stageId.endsWith(':LOST')

        if (isWon && isClosed) {
          // Выигранная закрытая = полученная выручка
          revenue.value += amount
          updateBucketCurrency(revenueCurrency, currency)
        } else if (isLost && isClosed) {
          // Проигранная закрытая = потерянная выручка
          lost.value += amount
          updateBucketCurrency(lostCurrency, currency)
        } else if (!isClosed) {
          // Любая незакрытая сделка идёт в потенциальную выручку.
          potential.value += amount
          updateBucketCurrency(potentialCurrency, currency)
        }
      }
    } catch (err: any) {
      error.value = err?.message || 'Ошибка при загрузке данных о сделках'
      console.error('useDealStats error:', err)
    } finally {
      loading.value = false
    }
  }

  // Инициальная загрузка
  fetchDeals()

  return {
    revenue: computed(() => revenue.value),
    lost: computed(() => lost.value),
    potential: computed(() => potential.value),
    revenueCurrency: computed(() => revenueCurrency.value),
    lostCurrency: computed(() => lostCurrency.value),
    potentialCurrency: computed(() => potentialCurrency.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    refresh: fetchDeals
  } as unknown as DealStats
}
