Feature: Delete a user in realm
    As a Tide Cloak admin user
    I want to delete a user in realm

    Scenario: Admin deletes a user successfully
        Given the admin in the tide admin console selects realm <realm_name>
        When the admin searches for user <username> goto user page and delete
        Then the user <username> will not be visible in the user list


        Examples:

            | realm_name | username |
            | testrealm  | user1    |
            | testrealm  | user2    |