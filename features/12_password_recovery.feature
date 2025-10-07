Feature: Create a new user in testrealm realm
  As a Tide Cloak admin user
  I want to create a user in realm

  
  Scenario: Admin creates a new user successfully
    Given the admin in the tide admin console selects realm <realm_name>
    When the user <username> gets recovery link to email and takes action and changes to new password <new_passwd>
    Then the user gets account recovered success message


    Examples:

      | realm_name | username  | new_passwd |
      | testrealm  | passtest2 | test2      |