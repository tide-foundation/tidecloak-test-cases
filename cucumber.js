module.exports = {
    default: {
        paths: ['features-cucumber/**/*.feature'],
        require: ['step_definitions/**/*.js', 'support/**/*.js'],
        format: [
            'progress-bar',
            'json:reports/results.json',
            'html:reports/report.html'
        ],
        formatOptions: {
            snippetInterface: 'async-await'
        },
        parallel: 1,  // Serial execution required for Docker lifecycle
        dryRun: false,
        failFast: false
    },
    'create-nextjs': {
        paths: ['features-cucumber/create-nextjs/*.feature'],
        require: ['step_definitions/**/*.js', 'support/**/*.js'],
        tags: '@create-nextjs',
        format: ['progress-bar']
    },
    'js-sdk': {
        paths: ['features-cucumber/tidecloak-js/*.feature'],
        require: ['step_definitions/**/*.js', 'support/**/*.js'],
        tags: '@tidecloak-js',
        format: ['progress-bar']
    },
    'nextjs-sdk': {
        paths: ['features-cucumber/tidecloak-nextjs/*.feature'],
        require: ['step_definitions/**/*.js', 'support/**/*.js'],
        tags: '@tidecloak-nextjs',
        format: ['progress-bar']
    },
    'tidecloak': {
        // Explicit ordering to ensure cleanup runs last
        paths: [
            'features-cucumber/tidecloak/admin.feature',
            'features-cucumber/tidecloak/email.feature',
            'features-cucumber/tidecloak/zz_cleanup.feature',
        ],
        require: ['step_definitions/**/*.js', 'support/**/*.js'],
        tags: '@tidecloak',
        format: ['progress-bar']
    },
    'tidecloak-admin': {
        paths: ['features-cucumber/tidecloak/admin.feature'],
        require: ['step_definitions/**/*.js', 'support/**/*.js'],
        tags: '@admin',
        format: ['progress-bar']
    },
    'tidecloak-email': {
        // Include the SMTP setup scenario that lives in admin.feature
        paths: [
            'features-cucumber/tidecloak/admin.feature',
            'features-cucumber/tidecloak/email.feature',
            'features-cucumber/tidecloak/zz_cleanup.feature',
        ],
        require: ['step_definitions/**/*.js', 'support/**/*.js'],
        tags: '@email',
        format: ['progress-bar']
    }
};
