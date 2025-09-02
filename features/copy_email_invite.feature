Feature: Admin verify email for account verification
    As a tide admin user
    I want to copy link for email verification and verify the email address

    Scenario: Admin verifies user by using verification link in new tab
        Given the admin in the tide admin console selects realm <realm_name>
        When the admin searches for user <username> and copy link for email for verification
        Then the copies link and opens it in new tab and email is verified

        Examples:
            | realm_name | username |
            | testrealm  | user1    |