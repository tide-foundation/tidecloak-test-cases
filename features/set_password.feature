Feature: Admin sets default password for user in testrealm realm
  As a Tide Cloak admin user
  I want to set default password for user in testrealm

  Scenario: Admin sets default password for user successfully
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin sets default password <password> for user <username>
    Then the admin can see password has been created and has reset button under credentials tab


    Examples:

      | realm_name | username | password  |
      | testrealm  | user1    | password1 |