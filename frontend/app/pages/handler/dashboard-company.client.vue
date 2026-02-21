<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'
import { ref, onMounted, computed } from 'vue'
import { useDashboard } from '@bitrix24/b24ui-nuxt/utils/dashboard'

definePageMeta({
  layout: 'placement'
})

/**
 * [REPLACED BLOCK]
 * useI18n должен вызываться на верхнем уровне setup.
 * Ранее useI18n вызывался внутри onMounted, что приводило к runtime-ошибке:
 * "Must be called at the top of a setup function".
 */
const { t, locales: localesI18n, setLocale } = useI18n()
const { $logger, initApp, b24Helper, destroyB24Helper, processErrorGlobal } = useAppInit('dashboard_company')
const { $initializeB24Frame } = useNuxtApp()

let $b24: null | B24Frame = null
let entityId = ref<number | string>('unknown')
let dealStats: any = null

const { contextId, isLoading: isLoadingState, load } = useDashboard({ isLoading: ref(false), load: () => {} })
const isLoading = computed({
  get: () => isLoadingState?.value === true || dealStats?.loading?.value === true,
  set: (value: boolean) => {
    load?.(value, contextId)
  }
})

const isInit = ref(false)

/**
 * [NEW BLOCK]
 * Резолвер ID сущности для CRM-вкладки.
 * Приоритет:
 * 1) placement.options.ID (стабильный источник для placement)
 * 2) getContext().documentId fallback
 */
// Для CRM-вкладок основным источником ID считаем placement.options.ID, context.documentId оставляем резервным вариантом.
function resolveCompanyId(frame: B24Frame): number | string {
  const placementId = frame.placement?.options?.ID
  if (placementId) {
    return placementId
  }

  const contextId = frame.getContext()?.documentId
  if (contextId) {
    return contextId
  }

  return 'unknown'
}

onMounted(async () => {
  try {
    isLoading.value = true
    $b24 = await $initializeB24Frame()
    
    // Инициализируем приложение
    await initApp($b24, localesI18n, setLocale)

    // В CRM placement обычно приходит ID в placement.options.ID,
    // а getContext().documentId оставляем как резервный вариант.
    entityId.value = resolveCompanyId($b24)
    $logger.info(`Company ID: ${entityId.value}`, {
      placementOptions: $b24.placement?.options,
      context: $b24.getContext?.()
    })
    if (entityId.value === 'unknown') {
      $logger.warn('Company ID was not found in placement options or context')
    }

    /**
     * [NEW BLOCK]
     * Источник аналитики на фронтенде:
     * - useDealStats выполняет прямые REST-вызовы через официальный JS SDK.
     */
    // Статистику сделок загружаем с фронтенда через REST SDK для текущей компании.
    dealStats = useDealStats($b24, entityId.value, 'company')

    // Устанавливаем размер фрейма
    await $b24?.parent.fitWindow()

    isInit.value = true
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true
    })
  } finally {
    isLoading.value = false
  }
})

const handleRefresh = async () => {
  if (dealStats) {
    await dealStats.refresh()
  }
}
</script>

<template>
  <div class="p-4">
    <div v-if="isInit && dealStats" class="space-y-4">
      <!-- Заголовок -->
      <div class="mb-6">
        <h2 class="text-lg font-bold">Статистика сделок</h2>
        <p class="text-sm text-gray-500">Компания ID: {{ entityId }}</p>
      </div>

      <!-- KPI Карточки -->
      <div class="grid grid-cols-3 gap-4">
        <!-- Полученная выручка -->
        <B24Card variant="outline">
          <div class="p-4 text-center">
            <p class="text-sm text-gray-600 mb-2">Полученная выручка</p>
            <p v-if="dealStats.loading.value" class="text-xl font-bold">...</p>
            <p v-else class="text-2xl font-bold text-green-600">
              {{ dealStats.revenue.value.toFixed(0) }} {{ dealStats.revenueCurrency.value || 'USD' }}
            </p>
          </div>
        </B24Card>

        <!-- Потерянная выручка -->
        <B24Card variant="outline">
          <div class="p-4 text-center">
            <p class="text-sm text-gray-600 mb-2">Потерянная выручка</p>
            <p v-if="dealStats.loading.value" class="text-xl font-bold">...</p>
            <p v-else class="text-2xl font-bold text-red-600">
              {{ dealStats.lost.value.toFixed(0) }} {{ dealStats.lostCurrency.value || 'USD' }}
            </p>
          </div>
        </B24Card>

        <!-- Потенциальная выручка -->
        <B24Card variant="outline">
          <div class="p-4 text-center">
            <p class="text-sm text-gray-600 mb-2">Потенциальная выручка</p>
            <p v-if="dealStats.loading.value" class="text-xl font-bold">...</p>
            <p v-else class="text-2xl font-bold text-blue-600">
              {{ dealStats.potential.value.toFixed(0) }} {{ dealStats.potentialCurrency.value || 'USD' }}
            </p>
          </div>
        </B24Card>
      </div>

      <!-- Ошибка (если есть) -->
      <div v-if="dealStats.error.value" class="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
        {{ dealStats.error.value }}
      </div>

      <!-- Кнопка обновления -->
      <div class="flex justify-center">
        <B24Button
          color="air-primary"
          :loading="dealStats.loading.value"
          @click="handleRefresh"
        >
          Обновить
        </B24Button>
      </div>
    </div>

    <!-- Загрузка -->
    <div v-else-if="!isInit" class="text-center py-8">
      <p class="text-gray-500">Загрузка...</p>
    </div>
  </div>
</template>
