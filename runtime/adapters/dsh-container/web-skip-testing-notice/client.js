window.__ModuleLoader__.load({
  id: 'dsh-web-skip-testing-notice',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('settings.onboarding', () => ctx.slots.register(
          { name: 'settings.onboarding', id: 'welcome-notice', order: -100, priority: -1 },
          ({ complete }) => {
            React.useEffect(() => { complete() }, [complete])
            return null
          },
        )), 'web-skip-testing-notice: skip testing notice')
      },
    }
  },
})
