Feature: Enable user in realm
    As a tide admin user
    I want to enable user so user can login or use the system

    Scenario: Admin enables user in realm
        Given the admin in the tide admin console selects realm <realm_name>
        When the admin searches for user <username> goto user page and enables
        Then the user <username> will have only username in the user list
        And then user tries to login in with valid credentials <username> <password> ask for update password in login page

        Examples:
            | realm_name | username | password  |
            | testrealm  | user1    | password1 |