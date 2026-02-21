import {computed, type ComputedRef, ref} from "vue";
import { LoggerBrowser, AjaxError, LoadDataType, useB24Helper } from '@bitrix24/b24jssdk'
import type { B24Frame } from '@bitrix24/b24jssdk'
import type { Locale } from 'vue-i18n'
import type { LocaleObject } from '@nuxtjs/i18n'

export interface ProcessErrorData {
  description?: string
  isShowClearError?: boolean
  clearErrorHref?: string
  clearErrorTitle?: string
  homePageIsHide?: boolean
  homePageHref?: string
  homePageTitle?: string
}

const { initB24Helper, getB24Helper, destroyB24Helper: destroyB24HelperOry, usePullClient, useSubscribePullClient, startPullClient } = useB24Helper()
const isInitB24Helper = ref(false)

const moduleId = 'main'

/**
 * Компосабл инициализации приложения
 * Координирует загрузку данных через batch-запрос
 */
export const useAppInit = (loggerTitle?: string) => {
  const $logger = LoggerBrowser.build(
    loggerTitle ?? 'App',
    import.meta.dev
  )

  // Хранилища
  const appSettings = useAppSettingsStore()
  const userSettings = useUserSettingsStore()
  const user = useUserStore()
  const api = useApiStore()

  /**
   * Инициализация данных приложения
   * Выполняет batch-запрос и обновляет все хранилища
   */
  async function initApp(
    $b24: B24Frame,
    localesI18n: ComputedRef<LocaleObject[]>,
    setLocale: (locale: Locale) => Promise<void>
  ) {
    $logger.info('InitApp start')
    /**
     * [NEW BLOCK]
     * Назначение:
     * - Экспортировать инициализированный SDK-экземпляр в консоль браузера в dev-режиме.
     * Зачем:
     * - При отладке внутри iframe Bitrix24 глобальный BX24 может быть недоступен.
     * - Это даёт стабильный диагностический хендл: window.__b24.
     */
    // Экспорт SDK только для отладки в браузерной консоли.
    // Используется для проверки scope/placement без доступа к внутренностям компонента.
    if (import.meta.client && import.meta.dev) {
      (window as any).__b24 = $b24
      $logger.log('Debug SDK handle exported to window.__b24')
    }

    await initLang($b24, localesI18n, setLocale)

    await initB24Helper(
      $b24,
      [
        LoadDataType.App,
        LoadDataType.AppOptions,
        LoadDataType.UserOptions,
        LoadDataType.Currency,
        LoadDataType.Profile
      ]
    )
    isInitB24Helper.value = true

    const data = {
      appInfo: getB24Helper().appInfo,
      appSettings: getB24Helper().appOptions,
      userSettings: getB24Helper().userOptions,
      profileData: getB24Helper().profileInfo,
    }
    $logger.log('Init data >>', data)

    /**
     * @memo Это можно использовать вместо `initB24Helper`
     */
    // const commands = {
    //   appInfo: { method: 'app.info' },
    //   appSettings: { method: 'app.option.get' },
    //   userSettings: { method: 'user.option.get' },
    //   profileData: { method: 'profile' }
    // }
    //
    // const response = await $b24.callBatch(commands)
    //
    // const data = response.getData()
    // $logger.log('Init data >>', data)

    // Обновляем хранилища полученными данными
    user.initFromBatch({
      id: data.profileData?.data.id ?? undefined,
      name: data.profileData?.data.name ?? undefined,
      lastName: data.profileData?.data.lastName ?? undefined,
      isAdmin: data.profileData?.data.isAdmin
    })

    appSettings.setB24($b24)
    appSettings.initFromBatch({
      version: (data.appInfo?.data.version ?? 1),
      status: data.appInfo?.data.status,
      configSettings: (data.appSettings?.data ?? new Map()).get('configSettings')
    })

    userSettings.setB24($b24)
    userSettings.initFromBatch({
      configSettings: (data.userSettings?.data ?? new Map()).get('configSettings')
    })

    await api.init($b24)

    $logger.info('InitApp stop')
  }

  async function initLang(
    $b24: B24Frame,
    localesI18n: ComputedRef<LocaleObject[]>,
    setLocale: (locale: Locale) => Promise<void>
  ) {
    const b24CurrentLang = $b24.getLang()
    if (localesI18n.value.filter(i => i.code === b24CurrentLang).length > 0) {
      await setLocale(b24CurrentLang)
      $logger.log('setLocale >>>', b24CurrentLang)
    } else {
      $logger.warn('not support locale >>>', b24CurrentLang)
    }
  }

  /**
   * Повторно загружает данные
   */
  async function reloadData() {
    await b24Helper.value?.loadData([
      LoadDataType.AppOptions,
      LoadDataType.UserOptions,
      LoadDataType.Currency
    ])

    const data = {
      appSettings: getB24Helper().appOptions,
      userSettings: getB24Helper().userOptions
    }

    $logger.log('Reload data >>', data)

    // Обновляем хранилища полученными данными
    appSettings.initFromBatch({
      configSettings: (data.appSettings?.data ?? new Map()).get('configSettings')
    })

    userSettings.initFromBatch({
      configSettings: (data.userSettings?.data ?? new Map()).get('configSettings')
    })

    $logger.info('reloadData stop')
  }

  const b24Helper = computed(() => {
    if (isInitB24Helper.value) {
      return getB24Helper()
    }

    return null
  })

  const destroyB24Helper = () => {
    isInitB24Helper.value = false
    destroyB24HelperOry()
  }

  function processErrorGlobal(
    error: unknown | string | Error,
    processErrorData?: ProcessErrorData
  ) {
    $logger.error(error)

    let statusMessage = 'Error'
    let message = ''
    let statusCode = 404

    if (error instanceof AjaxError) {
      statusCode = error.status
      statusMessage = error.name
      message = `${error.message}`
    } else if (error instanceof Error) {
      message = error.message
    } else {
      message = error as string
    }

    showError({
      statusCode,
      statusMessage,
      message,
      data: Object.assign({}, (processErrorData ?? {})),
      cause: error,
      fatal: true
    })
  }

  return {
    $logger,
    moduleId,
    initApp,
    initLang,
    reloadData,
    b24Helper,
    usePullClient,
    useSubscribePullClient,
    startPullClient,
    destroyB24Helper,
    processErrorGlobal
  }
}
