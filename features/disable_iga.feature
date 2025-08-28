Feature: Disable IGA in admin console
    As a Tide Cloak admin user
    I want to enable Identity Governance and Administration (IGA) 

  Scenario: Admin disables IGA
    Given the admin in the Tide admin console selects realm <realm_name>
    When the admin disables IGA for the realm
    Then the table in change request for clients is not visible

    Examples:
        | realm_name | 
        | testrealm  | 