Feature: Disable user in realm
    As a tide admin user
    I want to disable user so user cannot login or use the system

    Scenario: Admin disables user in realm
        Given the admin in the tide admin console selects realm <realm_name>
        When the admin searches for user <username> goto user page and disables
        Then the user <username> will have disable status in the user list
        And then user tries to login in with valid credentials <username> <password> but shows account disabled message in login page

        Examples:
            | realm_name | username | password  |
            | testrealm  | user1    | password1 |