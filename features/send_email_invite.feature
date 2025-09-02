Feature: Admin verify email for account verification
    As a tide admin user
    I want to copy link for email verification and verify the email address

    Scenario: Admin verifies user by using verification link in new tab
        Given the admin in the tide admin console selects realm <realm_name>
        When the admin searches for user <username> and sends email for verification
        Then the admin open mail service provider link login in
        And then verifies if email is received

        Examples:
            | realm_name | username |
            | testrealm  | user1    |