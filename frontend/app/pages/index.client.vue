<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'
import { onMounted } from 'vue'
import { useDashboard } from '@bitrix24/b24ui-nuxt/utils/dashboard'

const { t, locales: localesI18n, setLocale } = useI18n()

useHead({
  title: t('page.index.seo.title')
})

// region Инициализация ////
const { $logger, initApp, processErrorGlobal } = useAppInit('IndexPage')
const { $initializeB24Frame } = useNuxtApp()
let $b24: null | B24Frame = null

const apiStore = useApiStore()
// endregion ////

/**
 * [NEW BLOCK]
 * Константы placement для дашбордов тестового задания.
 * Используются и для верификации, и для сценария авто-привязки.
 */
const CONTACT_PLACEMENT = 'CRM_CONTACT_DETAIL_TAB'
const COMPANY_PLACEMENT = 'CRM_COMPANY_DETAIL_TAB'
const DASHBOARD_TITLE = 'Deals Dashboard'

/**
 * [NEW BLOCK]
 * Преобразует объект ошибки SDK в читаемую однострочную запись для логов.
 * Полезно для случаев, когда AjaxError имеет статус 200 и скрытый payload.
 */
function describeAjaxError(error: any): string {
  try {
    const responseData = error?.response?.data || error?.data || error?.answer
    const payload = typeof responseData === 'string' ? responseData : JSON.stringify(responseData)
    const code = error?.error || error?.code || error?.status || 'unknown'
    const message = error?.message || error?.description || 'Unknown error'
    return `[code=${code}] ${message}; payload=${payload || 'n/a'}`
  } catch {
    return String(error?.message || error || 'Unknown error')
  }
}

/**
 * [NEW BLOCK]
 * Унифицированная обёртка для placement.bind с логированием успеха/ошибки.
 * Возвращает boolean для упрощения ветвления в onMounted.
 */
async function bindPlacement(
  b24: B24Frame,
  placement: string,
  handler: string
): Promise<boolean> {
  try {
    // callBatch с одним методом используем намеренно: единый стиль вызова и обработки результата.
    const result = await b24.callBatch([{
      method: 'placement.bind',
      params: {
        PLACEMENT: placement,
        HANDLER: handler,
        TITLE: DASHBOARD_TITLE
      }
    }])
    $logger.info(`placement.bind success: ${placement}`, result?.getData?.() || {})
    return true
  } catch (error) {
    $logger.warn(`placement.bind failed: ${placement}. ${describeAjaxError(error)}`, error)
    return false
  }
}

// region Действия ////
async function getEnums() {
  const enums = await apiStore.getEnum()

  $logger.info(enums)
}

async function getItems() {
  const items = await apiStore.getList()

  $logger.info(items)
}
// endregion ////

const { contextId, isLoading: isLoadingState, load } = useDashboard({ isLoading: ref(false), load: () => {} })
const isLoading = computed({
  get: () => isLoadingState?.value === true,
  set: (value: boolean) => {
    $logger.info(load, value, contextId, isLoadingState?.value)
    load?.(value, contextId)
  }
})

// region Хуки жизненного цикла ////
const isInit = ref(false)
onMounted(async () => {
  $logger.info('Hi from index page')

  try {
    isLoading.value = true
    $b24 = await $initializeB24Frame()
    await initApp($b24, localesI18n, setLocale)

    // Заголовок вкладки приложения в слайдере/iframe Bitrix24.
    await $b24.parent.setTitle(t('page.index.seo.title'))
    /**
     * [REPLACED BLOCK]
     * Предыдущее поведение:
     * - Пробовали placement.get и останавливались при ошибке.
     * Текущее поведение:
     * - Пробуем placement.get.
     * - Если не удалось, выполняем прямой fallback-bind для contact/company.
     * - Если удалось, довешиваем только отсутствующие записи.
     *
     * [REMOVED LEGACY BLOCK]
     * - В старой реализации были разрозненные inline-вызовы bind и не было надёжного fallback-пути.
     */
    // Самовосстановление привязок с главной страницы.
    // Если placement.get недоступен, делаем прямой вызов placement.bind, чтобы не оставлять приложение в «мёртвом» состоянии.
    const appUrl = useRuntimeConfig().public.appUrl.replace(/\/+$/, '')
    const contactHandler = `${appUrl}/handler/dashboard-contact`
    const companyHandler = `${appUrl}/handler/dashboard-company`

    let placementList: any[] | null = null
    try {
      const resp = await $b24.callBatch({ placementList: { method: 'placement.get' } })
      placementList = resp.getData()?.placementList || []
    } catch (error) {
      $logger.warn(`placement.get failed, fallback to direct bind. ${describeAjaxError(error)}`, error)
    }

    if (placementList === null) {
      // fallback-ветка: если чтение placement недоступно, всё равно пытаемся зарегистрировать обе вкладки.
      await bindPlacement($b24, CONTACT_PLACEMENT, contactHandler)
      await bindPlacement($b24, COMPANY_PLACEMENT, companyHandler)
    } else {
      const contactExists = placementList.some((p: any) => {
        return p?.PLACEMENT === CONTACT_PLACEMENT && p?.HANDLER === contactHandler
      })
      const companyExists = placementList.some((p: any) => {
        return p?.PLACEMENT === COMPANY_PLACEMENT && p?.HANDLER === companyHandler
      })

      if (!contactExists) {
        await bindPlacement($b24, CONTACT_PLACEMENT, contactHandler)
      } else {
        $logger.info(`placement exists: ${CONTACT_PLACEMENT}`)
      }

      if (!companyExists) {
        await bindPlacement($b24, COMPANY_PLACEMENT, companyHandler)
      } else {
        $logger.info(`placement exists: ${COMPANY_PLACEMENT}`)
      }
    }

    isInit.value = true
  } catch (error) {
    processErrorGlobal(error)
  } finally {
    isLoading.value = false
  }
})
// endregion ////
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-16 h-[calc(100vh-200px)]">
    <B24Card
      v-if="isInit"
      :b24ui="{
        footer: 'flex flex-row flex-wrap items-center justify-start gap-2'
      }"
    >
      <template #header>
        <ProseH2>{{ $t('page.index.message.title') }}</ProseH2>
        <ProseP>{{ $t('page.index.message.line1') }}</ProseP>
      </template>

      <BackendStatus />

      <template #footer>
        <B24Button label="getEnums" loading-auto @click="getEnums" />
        <B24Button label="getItems" loading-auto @click="getItems" />
      </template>
    </B24Card>
  </div>
</template>
